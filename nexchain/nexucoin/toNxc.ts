import { formatNxc } from './formatNxc'

/**
 * nexu → NXC sebagai **string desimal**, tanpa operasi floating point.
 *
 * Mengembalikan string, bukan `number`, karena tidak semua nilai nexu
 * bisa direpresentasikan ulang sebagai `number` NXC: pada 8 desimal,
 * 90 juta NXC memerlukan 8 digit di kiri titik + 8 di kanan = 16 digit
 * signifikan, melebihi presisi `number` (≈15–17 digit). `number` akan
 * membulatkan diam-diam.
 *
 * Sebelumnya fungsi ini `nexu / Math.pow(10, 18)` — menghasilkan
 * `100.00049999999901` untuk saldo yang sebenarnya bulat.
 *
 * TIDAK menyertakan satuan "NXC" — lihat `formatNxcWithUnit`.
 *
 * @param nexu Nilai dalam nexu (bilangan bulat aman).
 * @param maxDecimals Maksimal digit desimal yang ditampilkan (default 8).
 * @returns String desimal NXC, mis. `"0.00025"`, `"500"`.
 * @throws Error bila `nexu` bukan bilangan bulat aman.
 *
 * @example
 * toNxc(25_000)    // "0.00025"
 * toNxc(50_000_000_000) // "500"
 */
export const toNxc = (nexu: number, maxDecimals?: number): string =>
	formatNxc(nexu, maxDecimals)
