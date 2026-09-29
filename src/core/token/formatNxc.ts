import { NXC_DECIMALS } from './constants'

/**
 * Konversi nexu → NXC **tanpa operasi floating point**.
 *
 * ========================================================================
 * MENGAPA BUKAN `nexu / 10 ** 8` + `toFixed(18)`
 * ========================================================================
 * Pembagian float menghasilkan nilai yang TIDAK tepat untuk sebagian
 * bilangan bulat besar, lalu `toFixed()` membulatkannya — menghasilkan
 * "ekor" desimal palsu yang tidak pernah ada di state. Contoh nyata dari
 * devnet ini sebelum perbaikan:
 *
 *     100.00049999999901 NXC      // saldo sebenarnya bulat
 *
 * Selain itu `toFixed` dengan desimal melebihi batas representasi
 * menghasilkan digit di kanan yang tidak bisa dipertanggungjawabkan.
 *
 * Fungsi ini memotong string: menyisipkan titik desimal pada posisi
 * tepat dari kanan. Eksak di semua nilai dan semua platform.
 *
 * ========================================================================
 * PENGGUNAAN
 * ========================================================================
 * - `formatNxc(25_000)`                     → `"0.00025"`
 * - `formatNxc(5_000_000_000_000_000)`      → `"50000000"`
 * - `formatNxc(25_000, 8)`                  → `"0.00025"`
 * - `formatNxc(-1)`                         → `"-0.00000001"`
 *
 * @param nexu Nilai dalam nexu (bilangan bulat).
 * @param maxDecimals Maksimal digit desimal yang ditampilkan
 *                     (default: seluruh presisi satuan).
 * @returns String desimal NXC tanpa satuan.
 * @throws Error bila `nexu` bukan bilangan bulat aman.
 */
export const formatNxc = (nexu: number, maxDecimals: number = NXC_DECIMALS): string => {
	if (!Number.isSafeInteger(nexu)) {
		throw new Error(
			`formatNxc menerima bilangan bulat aman saja, mendapat ${String(nexu)}`,
		)
	}
	if (!Number.isInteger(maxDecimals) || maxDecimals < 0) {
		throw new Error(`formatNxc: maxDecimals tidak valid (${maxDecimals})`)
	}

	const negative = nexu < 0
	// Math.abs aman: |nexu| ≤ Number.MAX_SAFE_INTEGER dan hasil positif.
	// String() pada bilangan bulat aman tidak pernah memakai notasi
	// eksponensial (itu baru terjadi di ≥ 1e21).
	const digits = String(Math.abs(nexu)).padStart(NXC_DECIMALS + 1, '0')

	const whole = digits.slice(0, -NXC_DECIMALS)
	const fraction = digits.slice(-NXC_DECIMALS)

	const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '')
	const body = trimmed.length > 0 ? `${whole}.${trimmed}` : whole

	return negative ? `-${body}` : body
}

/**
 * Format lengkap dengan satuan, memotong ke `maxDecimals` desimal.
 * Untuk tampilan ringkas (explorer/list); pakai `formatNxc` bila butuh
 * presisi penuh.
 */
export const formatNxcWithUnit = (
	nexu: number,
	maxDecimals: number = NXC_DECIMALS,
): string => `${formatNxc(nexu, maxDecimals)} NXC`
