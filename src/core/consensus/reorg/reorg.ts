/**
 * Eksekusi reorg: ganti tip lokal dengan cabang yang LEBIH BERAT.
 *
 * Ini konsumen branch pool + undo journal (M1). Aturannya:
 *
 *   1. **Fork choice = kerja kumulatif** (`./forkChoice.ts`), bukan tinggi.
 *   2. **Satu titik deteksi** — `onCompetingTip(tipHash)` (R-2). Semua pemanggil
 *      (P2P `connectBlock`) masuk lewat sini; tak ada jalur reorg lain.
 *   3. **Batas kedalaman** `MAX_REORG_DEPTH` — lebih dalam ditolak dengan
 *      pesan jelas (journal lebih tua sudah dipangkas, jadi rollback tak
 *      mungkin).
 *   4. **Rollback lewat journal** — `rollbackAbove(forkHeight)` mengembalikan
 *      state/history/block persis ke sebelum cabang lokal yang kalah.
 *   5. **Mempool opsi B** — transaksi dari blok yang dibalik DITAMBAH-ULANG
 *      eksplisit ke mempool sebelum cabang baru diputar; transaksi yang juga
 *      ada di cabang pemenang akan dibuang lagi saat bloknya diproses.
 *   6. **Replay senyap** — cabang baru di-commit lewat `chains.commitBlock`
 *      yang TIDAK menerbitkan peristiwa P2P, sehingga kita tidak menggosipkan
 *      ulang blok yang baru saja kita terima.
 *   7. **Jangan pernah re-commit blok yang sudah ada** — blok pemenang belum
 *      pernah kita commit (masih di pool), jadi aman; blok lokal yang kalah
 *      sudah di-rollback dan TIDAK di-commit ulang.
 *
 * Selama reorg, fase sync `forked` menahan `nex_getWork` (mining tidak
 * membangun di atas tip yang sedang berubah).
 */
import type { Block } from 'src/core/block/blockModel'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { chains } from 'src/core/block/initBlock'
import { addTxToMempool } from 'src/core/transaction/addTransactionToMempool'
import type { TxInterface } from 'src/types/transaction'
import {
	currentHeight,
	MAX_REORG_DEPTH,
	rollbackAbove,
} from 'src/core/state/journal/store'
import { markForked, markSynced } from 'src/core/events/syncState'
import { logToConsole } from 'src/logging/logging'
import { sumWork } from './forkChoice'
import {
	listPooled,
	poolSize,
	prunePoolAtOrAbove,
	prunePoolAtOrBelow,
	resetBranchPool,
} from './branchPool'
import { traceBranchToLocal } from './ancestry'
import {
	getVerifyMarker,
	invalidateVerifyMarkerFrom,
	resetVerifyMarker,
	setVerifyMarker,
} from 'src/core/consensus/verify/verifyMarker'

/** Hasil percobaan reorg (untuk RPC/gate/log). */
export interface ReorgResult {
	/** `true` bila tip benar-benar diganti. */
	status: boolean
	/** Alasan singkat (sukses maupun gagal) — untuk pesan yang jelas. */
	reason?: string
	/** Height blok nenek moyang bersama. */
	forkHeight?: number
	/** Height tip setelah reorg (bila berhasil). */
	newHeight?: number
	/** Jumlah blok lokal yang dibalik (bila berhasil). */
	rolledBack?: number
	/** Jumlah tx yatim yang berhasil dikembalikan ke mempool. */
	readded?: number
}

/** Penjaga tipis terhadap nilai DB yang tidak berbentuk `Block`. */
const asBlock = (value: unknown): Block | undefined => {
	if (
		value !== null &&
		typeof value === 'object' &&
		'block' in value &&
		(value as Block).block !== null
	) {
		return value as Block
	}
	return undefined
}

/** Baca segmen rantai lokal `[from, to]` (inklusif), mengabaikan yang hilang. */
const readLocalSegment = async (
	fromHeight: number,
	toHeight: number,
): Promise<Block[]> => {
	const out: Block[] = []
	for (let h = fromHeight; h <= toHeight; h++) {
		const block = asBlock(await getBlockByHeight(h, 'json'))
		if (block) out.push(block)
	}
	return out
}

/**
 * **R-1 `invalidateFrom(height)`** — satu titik untuk membuang SEMUA state
 * turunan ber-key height/hash >= `height` setelah tip berubah: branch pool DAN
 * marker verifikasi hash-keyed (`verifyMarker`, S4). Marker WAJIB ikut
 * dibersihkan di sini, kalau tidak jalur inkremental `nex_getWork` akan
 * mempercayai prefix blok yang sudah digantikan reorg.
 */
export const invalidateFrom = (height: number): number => {
	invalidateVerifyMarkerFrom(height)
	return prunePoolAtOrAbove(height)
}

/** Bersihkan seluruh state reorg in-memory (dipakai uji). */
export const resetReorgState = (): void => {
	resetBranchPool()
	resetVerifyMarker()
}

/**
 * **Titik deteksi tunggal (R-2).** Beri tahu node bahwa ada tip bersaing
 * `tipHash` (blok di branch pool). Bila cabangnya tersambung ke rantai lokal
 * DAN lebih berat, lakukan reorg; selain itu tidak ada yang terjadi.
 */
export const onCompetingTip = async (tipHash: string): Promise<ReorgResult> => {
	const traced = await traceBranchToLocal(tipHash)
	if (!traced) {
		return { status: false, reason: 'cabang tidak tersambung ke rantai lokal' }
	}

	const { forkHeight, branch } = traced
	if (branch.length === 0) {
		return { status: false, reason: 'cabang kosong', forkHeight }
	}

	const tipHeight = await currentHeight()
	if (tipHeight < 0) {
		return { status: false, reason: 'rantai lokal kosong', forkHeight }
	}

	const localSegment = await readLocalSegment(forkHeight + 1, tipHeight)
	const branchWork = sumWork(branch)
	const localWork = sumWork(localSegment)
	if (branchWork <= localWork) {
		return {
			status: false,
			reason: `cabang tidak lebih berat (${branchWork} <= ${localWork})`,
			forkHeight,
		}
	}

	markForked({ localHeight: tipHeight })
	logToConsole(
		`Reorg: cabang ${tipHash.slice(0, 12)}… lebih berat ` +
			`(${branchWork} > ${localWork}); ganti tip dari ${tipHeight} ke ` +
			`${forkHeight + branch.length} (fork di ${forkHeight}).`,
	)
	return await switchToBranch(branch, forkHeight)
}

/**
 * Cari cabang pooled TERBERAT yang tersambung ke rantai lokal lalu coba reorg.
 * Dipanggil `src/p2p/validation/connectBlock.ts` setelah menambah blok ke pool.
 */
export const reevaluateBranches = async (): Promise<ReorgResult> => {
	if (poolSize() === 0) return { status: false, reason: 'pool kosong' }

	// Kandidat cukup blok UJUNG cabang (yang bukan `prevHash` blok lain di
	// pool). Menelusuri hanya ujung menjaga biaya tetap mendekati jumlah
	// cabang, bukan kuadrat ukuran pool — penting saat peer mengirim blok
	// yang tak pernah tersambung.
	const entries = listPooled()
	const childPrevHashes = new Set(entries.map((entry) => entry.prevHash))
	const leaves = entries.filter((entry) => !childPrevHashes.has(entry.hash))
	const candidates = leaves.length > 0 ? leaves : entries

	let bestHash: string | undefined
	let bestWork = 0n
	for (const entry of candidates) {
		const traced = await traceBranchToLocal(entry.hash)
		if (!traced) continue
		const work = sumWork(traced.branch)
		if (bestHash === undefined || work > bestWork) {
			bestHash = entry.hash
			bestWork = work
		}
	}
	if (bestHash === undefined) {
		return { status: false, reason: 'tak ada cabang tersambung' }
	}
	return await onCompetingTip(bestHash)
}

/**
 * Eksekusi penggantian tip ke `branch` (urut menaik dari `forkHeight+1`).
 * Dipanggil HANYA oleh `onCompetingTip` setelah fork choice menentukan cabang
 * ini menang.
 */
export const switchToBranch = async (
	branch: Block[],
	forkHeight: number,
): Promise<ReorgResult> => {
	if (branch.length === 0) return { status: false, reason: 'cabang kosong' }

	const tipHeight = await currentHeight()
	if (tipHeight < 0) return { status: false, reason: 'rantai lokal kosong' }
	if (forkHeight < 0) return { status: false, reason: 'fork di bawah genesis' }

	const depth = tipHeight - forkHeight
	if (depth < 0) {
		return {
			status: false,
			reason: `forkHeight ${forkHeight} di atas tip lokal ${tipHeight}`,
		}
	}
	if (depth > MAX_REORG_DEPTH) {
		return {
			status: false,
			reason:
				`reorg terlalu dalam: ${depth} blok > MAX_REORG_DEPTH ` +
				`${MAX_REORG_DEPTH} (tip ${tipHeight} → fork ${forkHeight}); ` +
				`journal lebih tua sudah dipangkas sehingga rollback mustahil`,
			forkHeight,
		}
	}

	// Cabang harus menempel PERSIS ke blok lokal di forkHeight.
	const fork = asBlock(await getBlockByHeight(forkHeight, 'json'))
	if (
		!fork ||
		fork.block.header.hash !== branch[0].block.header.previousBlockHash
	) {
		return {
			status: false,
			reason: 'cabang tidak menempel ke nenek moyang lokal',
			forkHeight,
		}
	}

	// R-1: state turunan di >= forkHeight+1 kini basi. (Branch pemenang sudah
	// kita pegang di array `branch`, jadi menghapusnya dari pool aman.) Ini
	// juga membatalkan marker verifikasi di >= forkHeight+1.
	const markerBefore = getVerifyMarker()
	invalidateFrom(forkHeight + 1)

	// Prefiks [0..forkHeight] TIDAK berubah dan sudah pernah diverifikasi
	// (marker lama mencakupnya; hash blok fork dicek tak berubah di atas) —
	// benihkan ulang marker ke blok fork supaya verifikasi berikutnya tetap
	// inkremental, bukan penuh, setelah reorg.
	if (markerBefore !== undefined && markerBefore.height >= forkHeight + 1) {
		setVerifyMarker(forkHeight, fork.block.header.hash)
	}

	// (1) Kumpulkan tx dari blok lokal yang akan dibalik (menurun).
	const orphaned: TxInterface[] = []
	for (let h = tipHeight; h > forkHeight; h--) {
		const block = asBlock(await getBlockByHeight(h, 'json'))
		if (!block) continue
		for (const tx of block.block.transactions) orphaned.push(tx)
	}

	// (2) Rollback lewat undo journal.
	const rolled = await rollbackAbove(forkHeight)
	if (rolled < depth) {
		// Sebagian record hilang — jangan lanjut ke replay di atas state
		// setengah. Boot recovery akan merapikan; buka mining agar tak macet.
		markSynced()
		return {
			status: false,
			reason: `rollback tidak lengkap (${rolled}/${depth}; journal hilang?)`,
			forkHeight,
		}
	}

	// (3) Tambah-ulang tx yatim ke mempool (opsi B). Yang tak lagi valid
	// (mis. sudah tak cukup saldo setelah cabang baru nanti) cukup diabaikan.
	let readded = 0
	for (const tx of orphaned) {
		try {
			if (await addTxToMempool(tx)) readded++
		} catch {
			// abaikan: tx yatim yang tak dapat diterima kembali
		}
	}

	// (4) Replay cabang pemenang — SENYAP (commitBlock tidak menyiarkan).
	let committed = 0
	for (const block of branch) {
		const result = await chains.commitBlock(block)
		if (!result.status) {
			markSynced({ localHeight: forkHeight + committed })
			return {
				status: false,
				reason: `replay cabang gagal di height ${block.block.height}`,
				forkHeight,
				newHeight: forkHeight + committed,
				rolledBack: rolled,
				readded,
			}
		}
		committed++
	}

	const newHeight = forkHeight + committed
	markSynced({ localHeight: newHeight })
	// Buang sisa entri pool yang kini sudah lokal / basi.
	prunePoolAtOrBelow(newHeight)

	logToConsole(
		`Reorg selesai: tip baru ${newHeight}, ${rolled} blok dibalik, ` +
			`${readded} tx dikembalikan ke mempool.`,
	)
	return {
		status: true,
		reason: 'reorg sukses',
		forkHeight,
		newHeight,
		rolledBack: rolled,
		readded,
	}
}
