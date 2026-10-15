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
 *
 * Smoke ini SENGAJA menyentuh LevelDB, port, dan mutasi rantai — bukan
 * pengganti `check:p2p` yang offline. Proses anak dan direktori sementara
 * SELALU dibersihkan lewat try/finally, termasuk saat gagal (LevelDB
 * memegang kunci file sampai prosesnya benar-benar keluar — lihat
 * `dataDirCheck.ts`).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPowHasher } from 'src/core/consensus/Pow'
import { meetsDifficulty } from 'src/core/consensus/difficulty'
import { hexToString } from 'src/core/encoding/hex/hexToString'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import type { HexString } from 'src/types/block'

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

/** Batas menunggu boot node (RPC menjawab + genesis tertulis). */
const BOOT_TIMEOUT_MS = 30_000
/** Batas menunggu handshake B -> A terlihat di log node A. */
const PEER_WAIT_MS = 30_000
/** Batas mencari nonce — jauh di bawah TTL job (5 menit) di node. */
const MINE_TIMEOUT_MS = 120_000
/** Batas menunggu blok hasil mining sampai ke node B. */
const SYNC_TIMEOUT_MS = 90_000
/** Batas menunggu tx hasil relay sampai ke mempool node B. */
const TX_RELAY_TIMEOUT_MS = 30_000
const SYNC_POLL_MS = 500

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
// Helper gate
// ---------------------------------------------------------------------------

let pass = 0
let fail = 0

const check = (name: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}${extra ? `  [${extra}]` : ''}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? `  [${extra}]` : ''}`)
	}
}

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Klien JSON-RPC ke node hidup
// ---------------------------------------------------------------------------

let requestId = 0

const rpc = async <T>(
	url: string,
	method: string,
	params?: unknown,
): Promise<T> => {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++requestId,
			method,
			...(params === undefined ? {} : { params }),
		}),
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`)
	}
	const body = (await response.json()) as {
		result?: T
		error?: { code?: number; message?: string }
	}
	if (body.error) {
		throw new Error(body.error.message ?? `JSON-RPC error ${body.error.code}`)
	}
	return body.result as T
}

/** Subset field state rantai yang dibaca smoke ini. */
interface ChainState {
	currentBlockHeight?: number
	currentBlockHash?: string
}

/**
 * Baca state rantai lewat `nex_getBlockState`.
 *
 * Responsnya `stringToHex(JSON.stringify(state))` — hex DENGAN prefix `0x`
 * (lihat `src/rpc/method.ts`). `hexToString` adalah dekoder kanonik yang juga
 * dipakai UI; `Buffer.from(hex, 'hex')` akan senyap menghasilkan string
 * kosong karena berhenti di karakter 'x'.
 */
const readState = async (url: string): Promise<ChainState | undefined> => {
	const raw = await rpc<string | null>(url, 'nex_getBlockState')
	if (typeof raw !== 'string' || raw.length === 0) return undefined
	const parsed: unknown = JSON.parse(hexToString(raw as HexString))
	if (parsed === null || typeof parsed !== 'object') return undefined
	return parsed as ChainState
}

/** Subset field entri mempool yang dibaca smoke ini. */
interface MempoolEntry {
	txHash?: string
}

/** Baca isi mempool (`nex_getMempool` — JSON polos, bukan hex). */
const readMempool = async (url: string): Promise<MempoolEntry[]> => {
	const raw = await rpc<unknown>(url, 'nex_getMempool')
	return Array.isArray(raw) ? (raw as MempoolEntry[]) : []
}

/**
 * Nonce berikutnya untuk sebuah alamat (`nex_getNextNonce`).
 *
 * Responsnya `stringToHex(JSON.stringify(number))` — hex DENGAN prefix `0x`,
 * jadi didekode lewat `hexToString` lalu `JSON.parse`, sama seperti `readState`.
 */
const readNextNonce = async (url: string, address: string): Promise<number> => {
	const raw = await rpc<string>(url, 'nex_getNextNonce', address)
	if (typeof raw !== 'string' || raw.length === 0) return 0
	const parsed: unknown = JSON.parse(hexToString(raw as HexString))
	return typeof parsed === 'number' ? parsed : 0
}

/** Subset status sinkronisasi yang dibaca smoke ini (`nex_getSyncStatus`). */
interface SyncStatusView {
	phase?: string
	syncing?: boolean
	localHeight?: number
	targetHeight?: number
	updatedAt?: number
}

/** Baca status sinkronisasi (`nex_getSyncStatus` — JSON polos, bukan hex). */
const readSyncStatus = async (url: string): Promise<SyncStatusView> => {
	const raw = await rpc<unknown>(url, 'nex_getSyncStatus')
	if (raw === null || typeof raw !== 'object') return {}
	return raw as SyncStatusView
}

/** Subset snapshot peer yang dibaca smoke ini (`nex_getPeerInfo`). */
interface PeerInfoView {
	count?: number
	peers?: Array<{ handshaked?: boolean; status?: { bestHeight?: number } }>
	maxPeers?: number
}

/** Baca snapshot peer (`nex_getPeerInfo` — JSON polos, bukan hex). */
const readPeerInfo = async (url: string): Promise<PeerInfoView> => {
	const raw = await rpc<unknown>(url, 'nex_getPeerInfo')
	if (raw === null || typeof raw !== 'object') return {}
	return raw as PeerInfoView
}

// ---------------------------------------------------------------------------
// Proses node
// ---------------------------------------------------------------------------

interface SmokeNode {
	readonly label: string
	readonly child: ChildProcess
	readonly url: string
	output(): string
}

/**
 * Jalankan satu node dengan konfigurasi terisolasi.
 *
 * Kredensial method tulis dikosongkan supaya `nex_getWork`/`nex_submitWork`
 * deterministik: loopback tanpa Basic Auth. Nilai kosong di env anak MENANG
 * atas isi `.env` root (dotenv maupun loader native Bun tidak menimpa variabel
 * yang sudah ada), jadi hasilnya sama di mesin mana pun.
 */
const spawnNode = (
	label: string,
	dataDir: string,
	rpcPort: number,
	p2pPort: number,
	peers: string,
	extraEnv: Record<string, string> = {},
): SmokeNode => {
	const child = spawn('bun', ['apps/node/server.ts'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			NEX_DATA_DIR: dataDir,
			NEX_RPC_PORT: String(rpcPort),
			RPC_BIND_HOST: '127.0.0.1',
			RPC_USER: '',
			RPC_PASSWORD: '',
			NEX_P2P_ENABLED: '1',
			NEX_P2P_PORT: String(p2pPort),
			NEX_P2P_BIND_HOST: '127.0.0.1',
			NEX_P2P_PEERS: peers,
			// Sync berkala & reconnect dipendekkan supaya smoke cepat; produksi
			// memakai default 10 dtk / 15 dtk (`src/p2p/config.ts`).
			NEX_P2P_SYNC_INTERVAL_MS: '2000',
			NEX_P2P_RECONNECT_INTERVAL_MS: '3000',
			...extraEnv,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let log = ''
	const capture = (chunk: unknown): void => {
		// Batasi memori: cukup simpan EKOR log untuk diagnosis kegagalan.
		log = (log + String(chunk)).slice(-262_144)
	}
	child.stdout?.on('data', capture)
	child.stderr?.on('data', capture)
	return {
		label,
		child,
		url: `http://127.0.0.1:${rpcPort}/rpc`,
		output: () => log,
	}
}

/**
 * Tunggu RPC menjawab DAN genesis sudah tertulis (blok height 0 ada di
 * `nex_getRecentBlocks`). RPC bisa menjawab sebelum callback listen selesai
 * membuat genesis — menunggu blok 0 membuat "siap" benar-benar siap.
 */
const waitReady = async (node: SmokeNode): Promise<void> => {
	const deadline = Date.now() + BOOT_TIMEOUT_MS
	while (Date.now() < deadline) {
		if (node.child.exitCode !== null) {
			throw new Error(
				`${node.label} keluar lebih dulu (exit ${node.child.exitCode})`,
			)
		}
		try {
			const blocks = await rpc<unknown[]>(node.url, 'nex_getRecentBlocks', {
				count: 1,
			})
			if (Array.isArray(blocks) && blocks.length > 0) return
		} catch {
			// RPC belum siap menerima koneksi — coba lagi.
		}
		await delay(250)
	}
	throw new Error(`${node.label} tidak siap dalam ${BOOT_TIMEOUT_MS / 1000}s`)
}

/**
 * Hentikan proses anak dan tunggu benar-benar keluar sebelum direktori
 * datanya dihapus — LevelDB masih memegang kunci file sampai proses keluar,
 * dan di Windows itu membuat `rm` gagal dengan EBUSY.
 */
const stopNode = async (child: ChildProcess): Promise<void> => {
	if (child.exitCode !== null) return
	await new Promise<void>((done) => {
		const timer = setTimeout(done, 5000)
		child.once('exit', () => {
			clearTimeout(timer)
			done()
		})
		child.kill()
	})
}

/** Hapus direktori sementara, dengan percobaan ulang untuk lock OS lambat. */
const rmWithRetry = async (dir: string): Promise<void> => {
	for (let attempt = 0; attempt < 12; attempt++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true })
			return
		} catch {
			await delay(250)
		}
	}
	// Sisa file sementara bukan kegagalan produk — jangan menambah noise.
	console.log(`  (catatan) tidak bisa menghapus ${dir} — dilewati`)
}

// ---------------------------------------------------------------------------
// Mining satu blok lewat jalur RPC (identik dengan miner eksternal)
// ---------------------------------------------------------------------------

interface WorkJob {
	status?: boolean
	error?: string
	jobId?: string
	payload?: string
	difficulty?: number
	height?: number
	expiresAt?: number
}

interface SubmitResult {
	status?: boolean
	error?: string
}

interface MinedBlock {
	height: number
	hash: string
}

const mineOneBlock = async (
	url: string,
	minerAddress: string,
): Promise<MinedBlock> => {
	const work = await rpc<WorkJob>(url, 'nex_getWork', { minerAddress })
	if (
		!work.status ||
		typeof work.jobId !== 'string' ||
		typeof work.payload !== 'string' ||
		typeof work.difficulty !== 'number' ||
		typeof work.height !== 'number' ||
		typeof work.expiresAt !== 'number'
	) {
		throw new Error(
			`nex_getWork gagal: ${work.error ?? 'respons tidak lengkap'}`,
		)
	}

	const startedAt = Date.now()
	// Loop PoW memakai hasher ber-payload-tetap (satu encoding, banyak nonce).
	const deadline = Math.min(work.expiresAt, startedAt + MINE_TIMEOUT_MS)
	const hasher = createPowHasher(work.payload)
	let nonce = 0
	let hash = ''
	let found = false
	while (Date.now() < deadline) {
		hash = hasher.hash(nonce)
		if (meetsDifficulty(hash, work.difficulty)) {
			found = true
			break
		}
		nonce++
	}
	if (!found) {
		throw new Error(
			`nonce tidak ditemukan untuk difficulty ${work.difficulty} bits`,
		)
	}
	const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
	console.log(
		`  ....  nonce ${nonce} ditemukan dalam ${elapsed}s ` +
			`(difficulty ${work.difficulty} bits)`,
	)

	const submit = await rpc<SubmitResult>(url, 'nex_submitWork', {
		jobId: work.jobId,
		nonce,
		hash,
	})
	if (!submit.status) {
		throw new Error(`nex_submitWork ditolak: ${submit.error ?? 'unknown'}`)
	}
	return { height: work.height, hash }
}

// ---------------------------------------------------------------------------
// Alur smoke
// ---------------------------------------------------------------------------

const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-smoke-a-'))
const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-smoke-b-'))
const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-smoke-c-'))
let nodeA: SmokeNode | undefined
let nodeB: SmokeNode | undefined
let nodeC: SmokeNode | undefined

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
} catch (error) {
	fail++
	console.log(
		`  FAIL ${error instanceof Error ? error.message : String(error)}`,
	)
} finally {
	if (nodeC) await stopNode(nodeC.child)
	if (nodeB) await stopNode(nodeB.child)
	if (nodeA) await stopNode(nodeA.child)
	await rmWithRetry(tmpA)
	await rmWithRetry(tmpB)
	await rmWithRetry(tmpC)
}

// Lampiran diagnosis: ekor log tiap node hanya saat ada kegagalan.
if (fail > 0) {
	for (const node of [nodeA, nodeB, nodeC]) {
		if (!node) continue
		const tail = node.output().slice(-2000)
		if (tail.length > 0) {
			console.log(`\n---- log ${node.label} (ekor) ----\n${tail}`)
		}
	}
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exitCode = fail > 0 ? 1 : 0
