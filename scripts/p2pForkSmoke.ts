/**
 * Smoke REORG di jaringan hidup (`p2p:fork`).
 *
 * Jalankan: bun run p2p:fork
 *
 * `check:reorg` sudah membuktikan mesin reorg dengan hash PALSU — PoW tidak
 * pernah diverifikasi di sana. Gate ini menutup celah bukti itu dengan reorg
 * sungguhan antara dua node nyata:
 *
 *   1. Dua node dijalankan TERISOLASI (`NEX_P2P_PEERS` kosong) dari genesis
 *      yang sama. Genesis deterministik, jadi keduanya mulai dari blok 0
 *      dengan hash identik — tanpa itu, "fork" di bawah akan tak bermakna.
 *   2. Masing-masing menambang sendiri: node A dua blok, node B satu blok.
 *      Keduanya sah, keduanya berakar pada genesis yang sama: inilah fork.
 *   3. Node B di-restart dengan node A sebagai bootstrap (direktori datanya
 *      DIPERTAHANKAN, jadi ia benar-benar membawa cabangnya). Fork choice
 *      berbasis kerja (`Σ 2^difficulty`), bukan tinggi: cabang A punya 2 blok
 *      melawan 1, jadi A jelas lebih berat — tidak ada seri yang bergantung
 *      pada tie-break.
 *   4. Node B harus men-reorg ke cabang A: tip-nya jadi `a2`, bukan `b1`.
 *      Node A tidak boleh ikut pindah ke cabang B yang lebih ringan.
 *
 * Batasnya: di sini cabang A lebih PANJANG sekaligus lebih BERAT, jadi gate ini
 * tidak membedakan "menang karena kerja" dari "menang karena tinggi". Kasus
 * pembeda itu (cabang lebih pendek tapi lebih berat) sudah dibuktikan
 * deterministik oleh `check:reorg` dengan hash palsu; yang dibuktikan di sini
 * adalah mesinnya benar-benar jalan di jaringan nyata — wire v2, `connectBlock`,
 * penempatan cabang, dan eksekusi ulang state saat berpindah.
 *
 * Inilah bukti bahwa `src/p2p/validation/connectBlock.ts` + `src/core/
 * consensus/reorg/` benar-benar menyelesaikan percabangan di jaringan, termasuk
 * menjalankan ulang transaksi state saat berpindah cabang.
 *
 * Sama seperti `p2p:smoke`: menyentuh LevelDB, port, dan mutasi rantai —
 * bukan pengganti `check:reorg` yang offline.
 *
 * Biaya: tiga blok PoW, dan blok KE-2 selalu 22 bit (retarget naik 2 bit saat
 * jeda antar-blok nyaris nol) — jadi gate ini memakan puluhan detik sampai
 * beberapa menit, tergantung kecepatan mesin. Batas waktunya memakai
 * `JOB_TTL_MS`, bukan angka yang lebih ketat, supaya hasilnya tidak acak.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JOB_TTL_MS } from 'src/core/consensus/jobStore'
import {
	check,
	delay,
	failed,
	mineOneBlock,
	readState,
	report,
	rmWithRetry,
	spawnNode,
	stopNode,
	waitReady,
	SYNC_POLL_MS,
	type NodeProcess,
} from 'scripts/p2pHarness'

// ---------------------------------------------------------------------------
// Tetapan
// ---------------------------------------------------------------------------

const NODE_A_RPC = 18601
const NODE_A_P2P = 30601
const NODE_B_RPC = 18602
const NODE_B_P2P = 30602

/** Batas menunggu node B men-reorg ke cabang A setelah dipertemukan. */
const FORK_SYNC_TIMEOUT_MS = 90_000
/** Batas menunggu handshake terlihat di log node A. */
const PEER_WAIT_MS = 30_000

/**
 * Batas waktu PoW untuk gate ini. Blok KE-2 pada rantai baru selalu naik ke
 * 22 bit: `expectedDifficulty` mendaki `MAX_RISE_BITS` (2) saat jeda antar-blok
 * nyaris nol, dan itulah ~4x hash blok pertama. Batas default `mineOneBlock`
 * (120 dtk) hanya ~2.9x rata-rata blok 22 bit di mesin ~100 kH/s, jadi ~6%
 * peluang gagal acak — terlalu rawan untuk gerbang pra-push. Pakai TTL job-nya
 * sendiri (5 menit; `nex_submitWork` akan menolak sesudahnya) sebagai batas.
 */
const FORK_MINE_TIMEOUT_MS = JOB_TTL_MS

/**
 * Alamat hadiah tiap cabang — sengaja berbeda supaya coinbase kedua cabang
 * tidak identik dan fork-nya jelas berasal dari percabangan, bukan kebetulan.
 */
const MINER_A = `NxC${'aa'.repeat(20)}`
const MINER_B = `NxC${'bb'.repeat(20)}`

// ---------------------------------------------------------------------------
// Alur smoke
// ---------------------------------------------------------------------------

const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-fork-a-'))
const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p2p-fork-b-'))
let nodeA: NodeProcess | undefined
let nodeB: NodeProcess | undefined

try {
	console.log('Smoke P2P fork — dua cabang, lalu dipertemukan')

	// 1. Dua node TERISOLASI. Urutan boot tidak penting: tak ada peer.
	nodeA = spawnNode('node A', tmpA, NODE_A_RPC, NODE_A_P2P, '')
	await waitReady(nodeA)
	nodeB = spawnNode('node B', tmpB, NODE_B_RPC, NODE_B_P2P, '')
	await waitReady(nodeB)

	const genesisA = await readState(nodeA.url)
	const genesisB = await readState(nodeB.url)
	check(
		'dua node mulai dari genesis identik',
		genesisA?.currentBlockHash !== undefined &&
			genesisA.currentBlockHash === genesisB?.currentBlockHash &&
			genesisA.currentBlockHeight === 0,
		genesisA?.currentBlockHash?.slice(0, 16) + '...',
	)

	// 2. Masing-masing menambang cabangnya. A dua blok, B satu blok.
	const a1 = await mineOneBlock(nodeA.url, MINER_A, FORK_MINE_TIMEOUT_MS)
	const a2 = await mineOneBlock(nodeA.url, MINER_A, FORK_MINE_TIMEOUT_MS)
	const b1 = await mineOneBlock(nodeB.url, MINER_B, FORK_MINE_TIMEOUT_MS)

	check(
		'cabang A: dua blok (height 1 lalu 2)',
		a1.height === 1 && a2.height === 2,
	)
	check('cabang B: satu blok (height 1)', b1.height === 1)
	// Inti fork: dua blok height 1 dengan INDUK sama (genesis) tapi hash beda.
	check(
		'fork nyata: blok height 1 kedua cabang berbeda',
		a1.hash !== b1.hash,
		`A=${a1.hash.slice(0, 12)}... B=${b1.hash.slice(0, 12)}...`,
	)

	const beforeA = await readState(nodeA.url)
	const beforeB = await readState(nodeB.url)
	check(
		'selama terpisah, tip A = cabang A dan tip B = cabang B',
		beforeA?.currentBlockHeight === 2 &&
			beforeA.currentBlockHash === a2.hash &&
			beforeB?.currentBlockHeight === 1 &&
			beforeB.currentBlockHash === b1.hash,
		`A=${beforeA?.currentBlockHeight} B=${beforeB?.currentBlockHeight}`,
	)

	// 3. Pertemukan: restart B dengan A sebagai bootstrap. Data B dipertahankan
	//    (tidak ada `tmpB` baru), jadi B benar-benar datang membawa cabangnya.
	await stopNode(nodeB.child)
	nodeB = spawnNode(
		'node B',
		tmpB,
		NODE_B_RPC,
		NODE_B_P2P,
		`127.0.0.1:${NODE_A_P2P}`,
	)
	await waitReady(nodeB)

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

	// 4. Reorg: cabang A (2 blok) lebih berat dari cabang B (1 blok).
	const deadline = Date.now() + FORK_SYNC_TIMEOUT_MS
	let reorged = false
	while (Date.now() < deadline) {
		if (nodeB.child.exitCode !== null) {
			throw new Error(
				`node B keluar saat menunggu reorg (exit ${nodeB.child.exitCode})`,
			)
		}
		try {
			const state = await readState(nodeB.url)
			if (
				state?.currentBlockHeight === 2 &&
				state?.currentBlockHash === a2.hash
			) {
				reorged = true
				break
			}
		} catch {
			// RPC B sedang sibuk / reset koneksi — coba lagi.
		}
		await delay(SYNC_POLL_MS)
	}
	check(
		`node B men-reorg ke cabang A (height 2, tip ${a2.hash.slice(0, 12)}...) dalam <=${FORK_SYNC_TIMEOUT_MS / 1000}s`,
		reorged,
	)

	// 5. A tidak boleh ikut pindah ke cabang B yang lebih ringan.
	const afterA = await readState(nodeA.url)
	check(
		'node A tetap di cabangnya (cabang lebih ringan ditolak)',
		afterA?.currentBlockHeight === 2 && afterA.currentBlockHash === a2.hash,
		`height=${afterA?.currentBlockHeight}`,
	)

	// 6. Konvergen: dua node, satu rantai.
	const afterB = await readState(nodeB.url)
	check(
		'tip kedua node konvergen (height & hash sama)',
		afterA?.currentBlockHeight === afterB?.currentBlockHeight &&
			afterA?.currentBlockHash === afterB?.currentBlockHash &&
			afterA?.currentBlockHash !== undefined,
		`${afterA?.currentBlockHash?.slice(0, 16)}...`,
	)
} catch (error) {
	check(error instanceof Error ? error.message : String(error), false)
} finally {
	if (nodeB) await stopNode(nodeB.child)
	if (nodeA) await stopNode(nodeA.child)
	await rmWithRetry(tmpA)
	await rmWithRetry(tmpB)
}

// Lampiran diagnosis: ekor log tiap node hanya saat ada kegagalan.
if (failed()) {
	for (const node of [nodeA, nodeB]) {
		if (!node) continue
		const tail = node.output().slice(-2000)
		if (tail.length > 0) {
			console.log(`\n---- log ${node.label} (ekor) ----\n${tail}`)
		}
	}
}

report()
