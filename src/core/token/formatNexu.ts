import { formatNxc } from './formatNxc'

/**
 * Format nexu → string NXC bersatuan.
 *
 * Sebelumnya memakai `amountNexu / 10 ** 18` + `toFixed(decimal)`:
 *   - dasarnya salah (`decimal = 8` tapi dibagi `10 ** 18`)
 *   - `toFixed` pada angka besar menghasilkan digit desimal palsu
 *
 * Sekarang memotong string di posisi titik desimal yang tepat: eksak,
 * dan `decimal` benar-benar mengontrol jumlah digit yang ditampilkan.
 *
 * @param amountNexu Nilai dalam nexu (bilangan bulat aman).
 * @param decimal Maksimal digit desimal (default 8 — presisi penuh satuan).
 * @returns String bersatuan, mis. `"0.00025 NXC"`.
 * @throws Error bila `amountNexu` bukan bilangan bulat aman.
 */
export const formatNexu = (amountNexu: number, decimal: number = 8): string => {
	return `${formatNxc(amountNexu, decimal)} NXC`
}
