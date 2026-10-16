/**
 * Smoke test sinkronisasi P2P tiga node di localhost (`p2p:smoke`).
 *
 * Jalankan: bun run p2p:smoke
 *
 * Yang diuji (integrasi end-to-end terhadap node HIDUP, bukan unit):
 *
 *   1. Tiga proses node nyata dijalankan dengan `NEX_DATA_DIR` sendiri-sendiri
 *      (direktori sementara OS), port RPC & P2P berbeda, P2P menyala. Node A
 *      dan B saling menyusul; node C sengaja menunjuk peer mati.
 *   2. Node B menunjuk node A sebagai bootstrap peer (`NEX_P2P_PEERS`);
 *      handshake `version`/`verack` harus selesai (identitas jaringan cocok).
 *   2b. `nex_getPeerInfo` di node A harus melaporkan >=1 peer ter-handshake
 *      (bukti observability M3 lewat jalur netral `core/events/peerState.ts`).
 *   3. Satu blok di-mining di node A lewat jalur RPC miner eksternal yang
 *      sama persis: `nex_getWork` -> `createPowHasher` -> `nex_submitWork`,
 *      dengan alamat uji yang dibuat skrip ini (`NxC` + 40 hex — node tidak
 *      punya wallet, mining keyless). Blok ini sekaligus MENDANAI alamat itu.
 *   4. Blok itu harus sampai ke node B lewat pengumuman P2P (`inv` ->
 *      `getdata` -> `block` -> `connectBlock`): height DAN hash tip B harus
 *      sama dengan A dalam 90 detik.
 *   5. Sebuah transaksi bertanda tangan dari alamat uji dikirim ke node A;
 *      hashnya (`TxC` + 64 hex, 67 karakter) harus muncul di MEMPOOL node B
 *      lewat `inv` tx -> `getdata` -> `tx` -> `addTxToMempool` dalam 30 detik.
 *      Inilah bukti end-to-end relay transaksi (T01): tanpa perbaikan bentuk
 *      hash tx, langkah ini tidak akan pernah lolos.
 *   6. Gerbang IBD (T02) di node C yang menunjuk peer MATI: selama "syncing"
 *      `nex_getWork` harus DITOLAK, `nex_getSyncStatus` melaporkan fase yang
 *      benar, dan katup pengaman `NEX_P2P_SYNC_TIMEOUT_MS` membuka mining
 *      setelah timeout. Node C sengaja tak bisa menyusul agar hasilnya
 *      deterministik (bukan balapan handshake).
 *   7. Reconnect dengan seed berupa HOSTNAME (bukan IP): `peerManager` harus
 *      memakai endpoint KONFIGURASI sebagai identitas dial keluar. Bila ia
 *      memakai `remoteAddress` (IP hasil resolusi), kunci peta `outbound`
 *      tersangkut dan node berhenti mencoba selamanya — diam-diam. Skenario
 *      ini memakai socket loopback telanjang (tanpa node), jadi cepat dan
 *      deterministik.
 *   8. Reorg jaringan hidup ada di gate TERPISAH: `bun run p2p:fork`
 *      (`p2pForkSmoke.ts`) — dua node, dua cabang, lalu dipertemukan.
 *
 * Smoke ini SENGAJA menyentuh LevelDB, port, dan mutasi rantai — bukan
 * pengganti `check:p2p` yang offline. Proses anak dan direktori sementara
 * SELALU dibersihkan lewat try/finally, termasuk saat gagal (LevelDB
 * memegang kunci file sampai prosesnya benar-benar keluar — lihat
 * `dataDirCheck.ts`).
 */
/// <reference types="bun-types" />
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { loadP2PConfig } from 'src/p2p/config'
import { createPeerManager } from 'src/p2p/peers/peerManager'
import {
	check,
	delay,
	failed,
	mineOneBlock,
	readMempool,
	readNextNonce,
	readPeerInfo,
	readState,
	readSyncStatus,
	report,
	rmWithRetry,
	rpc,
	spawnNode,
	stopNode,
	waitReady,
	SYNC_POLL_MS,
	type NodeProcess,
	type WorkJob,
} from 'scripts/p2pHarness'

// ---------------------------------------------------------------------------
// Tetapan
// ---------------------------------------------------------------------------

const NODE_A_RPC = 18501
const NODE_B_RPC = 18502
const NODE_C_RPC = 18503
const NODE_A_P2P = 30501
const NODE_B_P2P = 30502
const NODE_C_P2P = 30503

/** Peer yang SENGAJA tidak ada — untuk memicu gerbang IBD di node C. */
const DEAD_PEER = '127.0.0.1:30599'

/**
 * Katup pengaman node C dibuat cukup lebar agar pemeriksaan "masih syncing"
 * hampir pasti kebagian (boot biasanya < 2 dtk), tetapi tetap cepat dibuka.
 */
const SYNC_GATE_TIMEOUT_MS = '15000'
/** Batas menunggu katup pengaman membuka mining di node C. */
const VALVE_WAIT_MS = 30_000

/** Batas menunggu handshake B -> A terlihat di log node A. */
const PEER_WAIT_MS = 30_000
/** Batas menunggu blok hasil mining sampai ke node B. */
const SYNC_TIMEOUT_MS = 90_000
/** Batas menunggu tx hasil relay sampai ke mempool node B. */
const TX_RELAY_TIMEOUT_MS = 30_000

/**
 * Alamat penerima tx uji — alamat sah (`NxC` + 40 hex huruf kecil) yang tidak
 * dipegang siapa pun. Dipakai hanya agar tx punya tujuan yang valid.
 */
const RECEIVER_ADDRESS = `NxC${'11'.repeat(20)}`

/**
 * Jumlah & fee tx uji, dalam nexu. Fee harus melampaui lantai laju-fee
 * (`MIN_FEE_RATE_NEXU_PER_KB` = 1000 nexu/byte), dan `amount >= fee`.
 */
const TX_AMOUNT_NEXU = 1_000_000
const TX_FEE_NEXU = 10_000

// ---------------------------------------------------------------------------
// Alur smoke
// ---------------------------------------------------------------------------

const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-smoke-a-'))
const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-smoke-b-'))
const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-smoke-c-'))
let nodeA: NodeProcess | undefined
let nodeB: NodeProcess | undefined
let nodeC: NodeProcess | undefined

try {
	console.log('Smoke P2P — tiga node localhost')
	console.log(`  node A: rpc :${NODE_A_RPC}, p2p :${NODE_A_P2P}, data ${tmpA}`)
	console.log(`  node B: rpc :${NODE_B_RPC}, p2p :${NODE_B_P2P}, data ${tmpB}`)

	// 1. Node A dulu — menjadi bootstrap target bagi B.
	nodeA = spawnNode('node A', tmpA, NODE_A_RPC, NODE_A_P2P, '')
	await waitReady(nodeA)
	check('node A boot & genesis tertulis', true, nodeA.url)

	// Guard: pastikan yang menjawab RPC MEMANG node kita, bukan node lain
	// yang kebetulan memegang port sama.
	check(
		'node A memakai direktori data sementara sendiri',
		nodeA.output().includes(tmpA),
		tmpA,
	)

	// 2. Node B di-start sesudah A siap supaya dial bootstrap pertama langsung
	//    menemukan listener (reconnect 3 dtk tetap jadi jaring pengaman).
	nodeB = spawnNode(
		'node B',
		tmpB,
		NODE_B_RPC,
		NODE_B_P2P,
		`127.0.0.1:${NODE_A_P2P}`,
	)
	await waitReady(nodeB)
	check('node B boot & genesis tertulis', true, nodeB.url)

	// 3. Tunggu handshake selesai di sisi A (baris "peer siap" dari
	//    `src/p2p/node.ts`). Tanpa ini, mining bisa terjadi sebelum koneksi
	//    terbentuk dan blok tidak punya tujuan siaran.
	const peerDeadline = Date.now() + PEER_WAIT_MS
	let peerSeen = false
	while (Date.now() < peerDeadline) {
		if (nodeA.output().includes('peer siap')) {
			peerSeen = true
			break
		}
		await delay(250)
	}
	check('handshake node B -> node A selesai (log "peer siap")', peerSeen)
	if (!peerSeen) {
		throw new Error(
			`tidak melihat "peer siap" di log node A dalam ${PEER_WAIT_MS / 1000}s`,
		)
	}

	// 3a. Observability: `nex_getPeerInfo` (M3) harus melaporkan peer B yang
	//     sudah handshake dari sisi A. Ini membuktikan jalur netral
	//     core/events/peerState.ts benar-benar terisi oleh peer manager.
	const peerInfoA = await readPeerInfo(nodeA.url)
	check(
		'nex_getPeerInfo di node A melaporkan >=1 peer ter-handshake',
		(peerInfoA.count ?? 0) >= 1 &&
			(peerInfoA.peers ?? []).some((p) => p.handshaked === true),
		`count=${peerInfoA.count ?? '?'}`,
	)

	// 3b. Alamat uji dibuat DI SINI — node tidak punya wallet. Blok berikutnya
	//     di-mining ke alamat ini sehingga ia ber-saldo dan bisa mengirim tx.
	const phrase = genRandomMnemonic()
	const { privateKey, publicKey } = generateKeysFromMnemonic(phrase)
	const sender = generateAddressFromPublicKey(publicKey.slice(2))
	console.log(`  sender uji: ${sender}`)

	// 4. Mining satu blok di A ke alamat sender — keyless, sekaligus mendanai.
	const mined = await mineOneBlock(nodeA.url, sender)
	check(
		`blok #${mined.height} diterima node A`,
		true,
		mined.hash.slice(0, 16) + '...',
	)
	const stateA = await readState(nodeA.url)
	check(
		'tip node A bergerak ke blok yang sama',
		stateA?.currentBlockHeight === mined.height &&
			stateA?.currentBlockHash === mined.hash,
		`height=${stateA?.currentBlockHeight}`,
	)

	// 5. Poll node B: blok harus sampai lewat inv -> getdata -> block.
	const syncDeadline = Date.now() + SYNC_TIMEOUT_MS
	let synced = false
	while (Date.now() < syncDeadline) {
		if (nodeB.child.exitCode !== null) {
			throw new Error(
				`node B keluar saat menunggu sync (exit ${nodeB.child.exitCode})`,
			)
		}
		try {
			const state = await readState(nodeB.url)
			if (
				state?.currentBlockHeight === mined.height &&
				state?.currentBlockHash === mined.hash
			) {
				synced = true
				break
			}
		} catch {
			// RPC B sedang sibuk / reset koneksi — coba lagi.
		}
		await delay(SYNC_POLL_MS)
	}
	check(
		`node B menyusul height ${mined.height} dalam <=${SYNC_TIMEOUT_MS / 1000}s`,
		synced,
	)

	// 6. Relay transaksi end-to-end (inti T01). Sender sudah didanai blok di
	//    atas; kirim tx ke A, lalu hash `TxC…`-nya harus muncul di mempool B
	//    lewat inv tx -> getdata -> tx -> addTxToMempool.
	const nonce = await readNextNonce(nodeA.url, sender)
	const draft = createUnsignedTransaction(
		{
			amount: TX_AMOUNT_NEXU,
			format: 'nexu',
			sender,
			receiver: RECEIVER_ADDRESS,
			fee: TX_FEE_NEXU,
		},
		nonce,
	)
	if (!draft.status || !draft.tx) {
		throw new Error(`gagal membangun tx uji: ${draft.error ?? 'unknown'}`)
	}
	const signed = signTransaction(draft.tx, privateKey)
	const txHash = signed.txHash ?? ''
	check(
		'tx uji punya txHash ber-prefix `TxC` (67 karakter)',
		txHash.startsWith('TxC') && txHash.length === 67,
		txHash,
	)

	const accepted = await rpc<boolean>(
		nodeA.url,
		'nex_sendTransaction',
		encodeTx(signed),
	)
	check('node A menerima tx ke mempool', accepted === true)

	const txDeadline = Date.now() + TX_RELAY_TIMEOUT_MS
	let relayed = false
	while (Date.now() < txDeadline) {
		if (nodeB.child.exitCode !== null) {
			throw new Error(
				`node B keluar saat menunggu tx (exit ${nodeB.child.exitCode})`,
			)
		}
		try {
			const mempool = await readMempool(nodeB.url)
			if (mempool.some((entry) => entry?.txHash === txHash)) {
				relayed = true
				break
			}
		} catch {
			// RPC B sedang sibuk / reset koneksi — coba lagi.
		}
		await delay(SYNC_POLL_MS)
	}
	check(
		`tx relay sampai mempool node B dalam <=${TX_RELAY_TIMEOUT_MS / 1000}s`,
		relayed,
		txHash,
	)

	// 7. Gerbang IBD (T02) di node C — deterministik, tanpa balapan.
	//    Node C menunjuk peer MATI, jadi ia tidak pernah menyelesaikan IBD lewat
	//    balasan `inv`; satu-satunya jalan keluar adalah katup pengaman
	//    `NEX_P2P_SYNC_TIMEOUT_MS`. Ini menguji:
	//      (a) saat "syncing", `nex_getWork` DITOLAK,
	//      (b) `nex_getSyncStatus` melaporkan fase dengan benar,
	//      (c) katup pengaman membuka mining setelah timeout.
	nodeC = spawnNode('node C', tmpC, NODE_C_RPC, NODE_C_P2P, DEAD_PEER, {
		NEX_P2P_SYNC_TIMEOUT_MS: SYNC_GATE_TIMEOUT_MS,
		NEX_P2P_RECONNECT_INTERVAL_MS: '1000',
	})
	await waitReady(nodeC)
	// Boot node menyajikan HTTP SEBELUM menulis genesis & memanggil
	// `startP2P()`, jadi tepat setelah `waitReady` fase bisa masih `idle`.
	// Tunggu sebentar sampai P2P menandai fase agar asersi tidak rapuh.
	let statusC = await readSyncStatus(nodeC.url)
	const phaseDeadline = Date.now() + 3_000
	while (statusC.phase === 'idle' && Date.now() < phaseDeadline) {
		await delay(100)
		statusC = await readSyncStatus(nodeC.url)
	}
	check(
		'node C (peer mati) masih "syncing" setelah boot',
		statusC.syncing === true && statusC.phase === 'syncing',
		`phase=${statusC.phase} syncing=${statusC.syncing}`,
	)
	const refused = await rpc<WorkJob>(nodeC.url, 'nex_getWork', {
		minerAddress: sender,
	})
	check(
		'nex_getWork DITOLAK saat syncing (gerbang IBD)',
		refused.status === false &&
			typeof refused.error === 'string' &&
			refused.error.includes('syncing'),
		refused.error ?? 'tanpa error',
	)

	const valveDeadline = Date.now() + VALVE_WAIT_MS
	let valveOpened = false
	while (Date.now() < valveDeadline) {
		const status = await readSyncStatus(nodeC.url)
		if (status.syncing === false) {
			valveOpened = true
			break
		}
		await delay(500)
	}
	check(
		`katup pengaman membuka mining setelah ~${Number(SYNC_GATE_TIMEOUT_MS) / 1000}s`,
		valveOpened,
	)
	const workC = await rpc<WorkJob>(nodeC.url, 'nex_getWork', {
		minerAddress: sender,
	})
	check(
		'nex_getWork kembali normal setelah syncing selesai',
		workC.status === true && typeof workC.jobId === 'string',
		workC.error ?? 'ok',
	)

	// 8. Reconnect dengan seed hostname. Listener telanjang ini menerima lalu
	//    LANGSUNG memutus tiap koneksi, sehingga `onClose` harus melepas kunci
	//    `outbound` agar interval reconnect mendial lagi. Bila kuncinya
	//    dihitung dari `remoteAddress` (`127.0.0.1`) sementara dial memakai
	//    `localhost`, kunci tak pernah terlepas → hanya 1 dial selamanya.
	let dialCount = 0
	const probeListener = Bun.listen<undefined>({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			data() {},
			open(socket) {
				dialCount++
				socket.end()
			},
		},
	})
	const probeManager = createPeerManager({
		config: {
			...loadP2PConfig({}),
			enabled: true,
			port: 0,
			// `localhost` TIDAK dinormalkan di sini: skenario ini menguji peer
			// manager, bukan `parsePeerList`. Yang penting host ≠ alamat remote.
			peers: [{ host: 'localhost', port: probeListener.port }],
			maxPeers: 2,
			reconnectIntervalMs: 150,
			pingIntervalMs: 60_000,
		},
		getLocalStatus: async () => ({
			chainId: 26,
			genesisHash: '0'.repeat(64),
			bestHeight: 0,
			bestHash: '0'.repeat(64),
		}),
		events: {
			onPeerReady() {},
			onPeerMessage() {},
			onPeerClosed() {},
		},
	})
	await probeManager.start()
	await delay(800)
	probeManager.stop()
	probeListener.stop(true)
	check(
		'reconnect: seed hostname didial ulang setelah koneksi putus',
		dialCount >= 2,
		`dial=${dialCount}`,
	)
} catch (error) {
	check(error instanceof Error ? error.message : String(error), false)
} finally {
	if (nodeC) await stopNode(nodeC.child)
	if (nodeB) await stopNode(nodeB.child)
	if (nodeA) await stopNode(nodeA.child)
	await rmWithRetry(tmpA)
	await rmWithRetry(tmpB)
	await rmWithRetry(tmpC)
}

// Lampiran diagnosis: ekor log tiap node hanya saat ada kegagalan.
if (failed()) {
	for (const node of [nodeA, nodeB, nodeC]) {
		if (!node) continue
		const tail = node.output().slice(-2000)
		if (tail.length > 0) {
			console.log(`\n---- log ${node.label} (ekor) ----\n${tail}`)
		}
	}
}

report()
