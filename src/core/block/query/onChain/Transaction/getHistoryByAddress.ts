import { getHistoryByTxHash } from './getHistoryByTxHash'
import { TxInterface } from 'src/types/transaction'
import { rocksHistory } from 'src/core/state/db/history'

/** Ukuran halaman bawaan — sama dengan `PAGE_SIZE` explorer. */
export const HISTORY_PAGE_SIZE = 25
/** Batas atas yang boleh diminta klien; di luar itu dipotong. */
export const HISTORY_MAX_PAGE_SIZE = 100

/** Permintaan halaman. Tanpa `query`, perilakunya sama seperti sebelum ada paginasi. */
export interface HistoryPageQuery {
	// `| undefined` eksplisit karena `exactOptionalPropertyTypes` aktif: pemanggil
	// boleh mengirim `{ page: undefined }` tanpa harus membangun objek bersyarat.
	page?: number | undefined
	pageSize?: number | undefined
}

export interface HistoryResult {
	history: TxInterface[]
	/** SELALU jumlah total entri alamat ini, bukan panjang `history` halaman ini. */
	count: number
	/** Hanya diisi pada mode berpaginasi. */
	page?: number
	pageSize?: number
	totalPages?: number
}

/**
 * `page` di bawah 1 / bukan angka → 1.
 *
 * Sengaja TIDAK melempar: halaman di luar jangkauan adalah kondisi normal
 * (user menekan "berikutnya" saat blok baru belum menambah apa pun), dan
 * membalas `[]` dengan `count` yang benar lebih berguna daripada error.
 */
const clampPage = (value: number | undefined): number => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 1
	const page = Math.trunc(value)
	return page < 1 ? 1 : page
}

/**
 * `pageSize` dipotong ke [1, 100].
 *
 * Batas atas melindungi node: tanpa itu satu permintaan bisa memaksa decode
 * ribuan transaksi dan mengirim respons raksasa, persis masalah yang
 * paginasi ini selesaikan.
 */
const clampPageSize = (value: number | undefined): number => {
	if (typeof value !== 'number' || !Number.isFinite(value))
		return HISTORY_PAGE_SIZE
	const size = Math.trunc(value)
	return Math.min(Math.max(size, 1), HISTORY_MAX_PAGE_SIZE)
}

/**
 * Riwayat satu alamat, terbaru dulu.
 *
 * Indeksnya per-entri (`addr:<alamat>:<tinggi 8 digit>:<txHash>`, ditulis
 * `saveTxByAddress`), jadi ini satu range scan — bukan baca array raksasa lalu
 * decode. `lt` memakai karakter tepat setelah `:` (`;`) sebagai batas atas
 * range, `reverse` menaruh blok terbaru di depan.
 *
 * DUA MODE:
 *
 * 1. Tanpa `query` — seluruh riwayat (dipakai explorer yang memaginasi di
 *    klien, dan `scripts/stateCheck.ts`). Perilaku tidak berubah.
 * 2. Dengan `query` — satu halaman + `count` total. Keduanya didapat dari
 *    SATU lintasan iterator: setiap key dihitung, tapi hanya key yang jatuh di
 *    jendela halaman yang di-decode. Jadi biaya decode selalu `pageSize`,
 *    sedangkan biaya langkah iterator tetap O(n) — harga yang dibayar untuk
 *    bisa menampilkan "halaman 3 dari 47" tanpa pindai kedua.
 *
 * Kalau suatu saat satu alamat melewati ~10^5 entri, ganti sumber `count`
 * menjadi counter `addrCount:<alamat>` yang ditulis di batch yang sama dengan
 * indeks (tidak ada penghapusan di indeks ini, jadi counter tidak bisa
 * melenceng ke bawah). Tanda tangan fungsi ini tidak perlu berubah.
 */
export const getHistoryByAddress = async (
	address: string,
	query?: HistoryPageQuery,
): Promise<HistoryResult> => {
	const prefix = `addr:${address}:`
	const range = {
		gte: prefix,
		lt: `${prefix.slice(0, -1)};`,
		reverse: true,
	}
	// `addr:<alamat>:<tinggi>:<txHash>` — `alamat` tidak mengandung `:`.
	const txHashOf = (key: string): string => key.split(':').pop()!

	if (query === undefined) {
		const txHashes: string[] = []
		for await (const key of rocksHistory.keys(range))
			txHashes.push(txHashOf(String(key)))

		const history = await Promise.all(
			txHashes.map((txHash) => getHistoryByTxHash(txHash)),
		)
		return { count: history.length, history }
	}

	const page = clampPage(query.page)
	const pageSize = clampPageSize(query.pageSize)
	const skip = (page - 1) * pageSize

	const txHashes: string[] = []
	let total = 0
	for await (const key of rocksHistory.keys(range)) {
		if (total >= skip && txHashes.length < pageSize)
			txHashes.push(txHashOf(String(key)))
		total += 1
	}

	const history = await Promise.all(
		txHashes.map((txHash) => getHistoryByTxHash(txHash)),
	)
	return {
		history,
		count: total,
		page,
		pageSize,
		totalPages: Math.ceil(total / pageSize),
	}
}
