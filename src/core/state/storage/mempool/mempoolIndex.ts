import { rocksMempool } from 'src/core/state/db/memPool'

/**
 * Indeks mempool PER-PENGIRM — sumber kebenaran jumlah tx pending satu
 * pengirim (ekspektasi nonce & `nex_getNextNonce`).
 *
 * ## Masalah yang diselesaikan (audit P1 #4, severe)
 *
 * Sebelumnya jumlah tx pending dihitung dari `loadMempool()` yang
 * membatasi 100 entri secara GLOBAL (urut key, bukan per-pengirim). Saat
 * mempool melebihi 100 tx:
 *   - jumlah milik satu pengirim bisa TERPOTONG → ekspektasi nonce turun →
 *     nonce yang sama bisa diajukan dua kali (transaksi kembar) dan reserve
 *     `pendingAmount` menumpuk tanpa bisa dilepas (dana terkunci permanen);
 *   - kebalikannya, tx pengirim bisa sepenuhnya di luar potongan → dihitung
 *     nol padahal masih pending.
 *
 * ## Mengapa indeks key, bukan counter tersimpan
 *
 * Opsi counter (`mpc:<from>` → angka) menyimpan jumlah yang bisa menyesat
 * selamanya bila satu update hilang (crash di luar batch, bug penulis
 * berikutnya). Indeks key menghitung dari data yang ADA (`mpf:<from>:<txHash>`
 * ada ⟺ entri mempool ada), sehingga:
 *   - jumlah = hasil iterasi range, bukan angka yang bisa usang;
 *   - entri yatim/tertinggal bisa dideteksi & diperbaiki (lihat
 *     `rebuildMempoolIndex`);
 *   - nilai entri menyimpan `cost` (amount+fee) sebagai bekal jalur buang
 *     ke depan, tanpa perlu membaca ulang transaksi penuh.
 *
 * ## Atomicity (kriteria tidak-negosiasi)
 *
 * Tulis/hapus entri mempool dan indeksnya SELALU dalam SATU `batch` level
 * (WAL ter grup) — lihat `saveMempool`/`removeMemPool`. Karena itu kunci
 * indeks tidak mungkin yatim maupun tertinggal oleh crash di tengah tulis.
 * Seluruh operasi indeks juga diserialkan lewat `runMempoolOp` (antrean
 * proses-satu), sehingga rebuild tidak bisa berimpit dengan admission.
 */

/** Key entri mempool — format yang dipakai sejak awal: `0x<txHash>`. */
export const mempoolTxKey = (txHash: string): string => `0x${txHash}`

/**
 * Key indeks per-pengirim: `mpf:<from>:<txHash>`.
 *
 * Nilai: `{ cost }` = amount+fee transaksi. Alamat tidak mengandung `:`
 * (hanya `NxC`/`NxS` + hex huruf kecil), jadi batas range per-pengirim
 * (`mpf:<from>:` s/d `mpf:<from>;`) tidak mungkin menyerempet alamat lain.
 */
export const senderIndexKey = (from: string, txHash: string): string =>
	`mpf:${from}:${txHash}`

/**
 * Rentang key entri mempool — SATU sumber untuk pembaca (loadMempool) dan
 * rekonsiliasi (rebuild), supaya keduanya tidak mungkin berbeda pendapat:
 *
 * - `"0x"` .. `"0y"`   : format yang ditulis `saveMempool` (`0x${txHash}`);
 * - `"Tx-"` .. `"Tx."` : format lama, dipertahankan agar data yang belum
 *                        terbaca tetap ikut terhitung & terangkat.
 */
export const TX_KEY_RANGES = [
	{ gte: '0x', lt: '0y' },
	{ gte: 'Tx-', lt: 'Tx.' },
]

/** Batas bawah range indeks per-pengirim: `mpf:<from>:`. */
const senderIndexGte = (from: string): string => `mpf:${from}:`
/** Batas kanan range indeks per-pengirim — `:` + 1 === `;` (0x3A → 0x3B). */
const senderIndexLt = (from: string): string => `mpf:${from};`

/** Rentang SELURUH indeks (untuk rekonsiliasi & sapuan). */
export const ALL_INDEX_GTE = 'mpf:'
export const ALL_INDEX_LT = 'mpf;'

// ---------------------------------------------------------------------------
// Antrean serial — satu untuk SEMUA operasi indeks/mempool
// ---------------------------------------------------------------------------

/**
 * Antrean serial operasi mempool (pola sama dengan `admissionQueue` di
 * `memPool.ts`). Semua tulis/baca indeks melewati ini, sehingga:
 *   - admission dan penghapusan tidak pernah berimpit dengan rebuild;
 *   - rebuild yang berjalan lama menunda admission berikutnya dengan aman
 *     (bukan memotong snapshotnya).
 */
let mempoolOpQueue: Promise<unknown> = Promise.resolve()

export const runMempoolOp = <T>(op: () => Promise<T>): Promise<T> => {
	const running = mempoolOpQueue.then(op)
	mempoolOpQueue = running.catch(() => undefined)
	return running
}

// ---------------------------------------------------------------------------
// Rekonsiliasi indeks ↔ mempool
// ---------------------------------------------------------------------------

type IndexOp =
	{ type: 'put'; key: string; value: string } | { type: 'del'; key: string }

/**
 * Badan rekonsiliasi — dijalankan HANYA dari dalam `runMempoolOp`.
 *
 *   1. pindai SELURUH entri mempool (TANPA limit 100 — ini perbaikan data,
 *      bukan penyusunan blok) dan kumpulkan `txHash`/`from`/`cost`;
 *   2. pindai SELURUH kunci indeks;
 *   3. satu batch: tambahkan indeks yang hilang (data lama / hasil crash
 *      luar-batch), buang indeks yatim (transaksinya sudah tidak ada).
 */
const rebuildBody = async (): Promise<void> => {
	const txHashes = new Set<string>()
	const wanted: Array<{ txHash: string; from: string; cost: number }> = []
	for (const range of TX_KEY_RANGES) {
		for await (const [, value] of rocksMempool.iterator({
			gte: range.gte,
			lt: range.lt,
			values: true,
			keys: false,
		})) {
			const tx = JSON.parse(value.toString()) as {
				txHash?: unknown
				from?: unknown
				amount?: unknown
				fee?: unknown
			}
			if (typeof tx.txHash !== 'string' || typeof tx.from !== 'string') {
				continue
			}
			txHashes.add(tx.txHash)
			wanted.push({
				txHash: tx.txHash,
				from: tx.from,
				cost:
					(typeof tx.amount === 'number' ? tx.amount : 0) +
					(typeof tx.fee === 'number' ? tx.fee : 0),
			})
		}
	}

	const ops: IndexOp[] = []
	for (const entry of wanted) {
		ops.push({
			type: 'put',
			key: senderIndexKey(entry.from, entry.txHash),
			// Nilai disimpan sebagai JSON-string — konsisten dengan entri
			// mempool (valueEncoding json mem-parse kembali jadi string).
			value: JSON.stringify({ cost: entry.cost }),
		})
	}

	for await (const key of rocksMempool.keys({
		gte: ALL_INDEX_GTE,
		lt: ALL_INDEX_LT,
	})) {
		const indexKey = key.toString()
		// `mpf:<from>:<txHash>` — `from` tidak pernah mengandung `:`, jadi
		// separator kedua selalu memisahkan txHash.
		const separator = indexKey.indexOf(':', 4)
		const txHash = separator < 0 ? '' : indexKey.slice(separator + 1)
		if (!txHash || !txHashes.has(txHash))
			ops.push({ type: 'del', key: indexKey })
	}

	if (ops.length > 0) await rocksMempool.batch(ops, { sync: false })
}

/**
 * Rekonsiliasi indeks ↔ mempool, berjalan di antrean serial.
 *
 * Dipanggil otomatis sekali per proses lewat `ensureMempoolIndex`, dan
 * bisa dipanggil manual sebagai alat perbaikan (mis. setelah pemulihan
 * backup mempool parsial).
 */
export const rebuildMempoolIndex = (): Promise<void> =>
	runMempoolOp(rebuildBody)

/** Janji rebuild sekali-proses — diset sinkron supaya single-flight. */
let indexReady: Promise<void> | null = null

/** Pastikan indeks sudah pernah direkonsiliasi ( sekali per proses ). */
export const ensureMempoolIndex = (): Promise<void> => {
	if (indexReady === null) indexReady = rebuildMempoolIndex()
	return indexReady
}

/**
 * Ambil `cost` (amount+fee) dari nilai indeks yang tersimpan; `0` bila
 * tidak terbaca.
 *
 * Nilai indeks ditulis `saveMempool` sebagai `JSON.stringify({ cost })`
 * di atas `valueEncoding: 'json'` — Level mem-parse kembali jadi STRING
 * saat dibaca (persis seperti entri mempool yang dibaca `rebuildBody`
 * lewat `JSON.parse(value.toString())`). Tapi bila suatu penulis
 * meletakkan objek langsung, bacanya sudah berupa objek — karena itu
 * dukung KEDUANYA, meniru idiom `senderOf` di `removeMemPool.ts`.
 */
const costOf = (stored: unknown): number => {
	try {
		const parsed: unknown =
			typeof stored === 'string' ? JSON.parse(stored) : stored
		if (parsed !== null && typeof parsed === 'object') {
			const cost = (parsed as { cost?: unknown }).cost
			return typeof cost === 'number' ? cost : 0
		}
	} catch {
		// nilai bukan JSON (sisa format sangat lama) — tanpa `cost`
	}
	return 0
}

/**
 * Statistik SATU-pindai milik satu pengirim: jumlah tx pending DAN total
 * reserve (`Σ cost`).
 *
 * Dipindai SEKALI dari range indeks (`mpf:<from>:` s/d `mpf:<from>;`) —
 * sumber yang sama dengan `countPendingBySender` — supaya jumlah dan
 * reserve tidak mungkin berbeda pendapat (tidak ada jendela di mana satu
 * admission menyelinap di antara dua pindai terpisah). Fondasi non-breaking
 * Gelombang 1 menuju reserve turunan per-pengirim: `pendingAmount` yang
 * hari ini disimpan terpisah nantinya diganti nilai turunan ini.
 */
export const senderIndexStats = async (
	from: string,
): Promise<{ count: number; totalCost: number }> => {
	await ensureMempoolIndex()
	return runMempoolOp(async () => {
		let count = 0
		let totalCost = 0
		for await (const [, value] of rocksMempool.iterator({
			gte: senderIndexGte(from),
			lt: senderIndexLt(from),
			values: true,
			keys: false,
		})) {
			count++
			totalCost += costOf(value)
		}
		return { count, totalCost }
	})
}

/**
 * Total reserve turunan (`Σ cost` = amount+fee) milik satu pengirim.
 *
 * Dihitung dari indeks per-pengirim — SELALU konsisten dengan
 * `countPendingBySender` karena keduanya satu pindai lewat
 * `senderIndexStats`. Dipakai paritas pra-cutover melawan
 * `pendingAmount` tersimpan (lihat `scripts/mempoolReserveCheck.ts`).
 */
export const sumCostBySender = async (from: string): Promise<number> =>
	(await senderIndexStats(from)).totalCost

/**
 * Batas tx pending per-pengirim — KEBIJAKAN node, BUKAN konsensus.
 *
 * MENGAPA ada (Gelombang 4): tanpa batas, satu akun bisa menghabiskan
 * seluruh slot pool global, dan pindai prefix reserve per-pengirim tidak
 * berbatas. Angka 16 meniru `AccountSlots` geth. Node yang berbeda BOLEH
 * memakai batas berbeda — isi mempool memang node-local (bukan fork),
 * jadi ini tidak perlu (dan tidak boleh) jadi aturan validitas blok.
 */
export const MAX_PENDING_PER_SENDER = 16

/**
 * Jumlah transaksi pending LENGKAP milik satu pengirim.
 *
 * Sumbernya indeks per-pengirim — TIDAK PERNAH `loadMempool` (yang
 * terpotong 100 secara global). Dipakai `validateTransactionNonce` dan
 * `nex_getNextNonce`; keduanya wajib melihat jumlah sebenarnya berapa pun
 * ukuran mempool.
 *
 * Mendelegasikan ke `senderIndexStats` supaya jumlah dan reserve (`Σ cost`)
 * selalu berasal dari SATU pindai yang sama — tanda tangan dan perilaku
 * tidak berubah.
 */
export const countPendingBySender = async (from: string): Promise<number> =>
	(await senderIndexStats(from)).count
