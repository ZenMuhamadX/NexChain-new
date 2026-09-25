import { MAX_SUPPLY_NEXU } from './constants'

/**
 * Validasi nilai on-chain: bilangan bulat, tidak negatif, dan tidak
 * melampaui plafon suplai.
 *
 * ========================================================================
 * MENGAPA TIGA SYARAT SEKALIGUS
 * ========================================================================
 * - `Number.isSafeInteger` — bilangan bulat aman (< 2^53) adalah satu-satunya
 *   kondisi di mana aritmetika `number` dijamin eksak. Nilai di atas itu
 *   BUKAN bilangan bulat menurut JavaScript (`Number.isInteger(1e20)` benar,
 *   tapi `Number.isSafeInteger(1e20)` salah), dan operasi `+`/`-` di atasnya
 *   dibulatkan diam-diam.
 * - `>= 0` — saldo dan fee tidak bisa negatif; ini menangkap pembulatan yang
 *   salah arah dari aritmetika yang tidak terjaga.
 * - `<= MAX_SUPPLY_NEXU` — suplai dibatasi 50 juta NXC supaya nilai apa pun
 *   tetap berada jauh di bawah batas aman (lihat `constants.ts`).
 *
 * Gagal-dulu: fungsi ini mengembalikan `false`, tidak pernah melempar.
 *
 * @param value Nilai dalam nexu yang akan dipasang ke state.
 * @returns `true` bila aman disimpan.
 */
export const isNexuCapped = (value: number): boolean => {
	return (
		Number.isSafeInteger(value) && value >= 0 && value <= MAX_SUPPLY_NEXU
	)
}

/**
 * Versi yang melempar — untuk jalur yang TIDAK boleh melanjutkan nilai
 * salah (penulisan state, kredit coinbase, komputasi reward).
 *
 * @throws Error bila `value` tidak aman disimpan.
 * @param value Nilai dalam nexu.
 * @param context Konteks untuk pesan error.
 */
export const assertNexuCapped = (value: number, context: string): void => {
	if (!isNexuCapped(value)) {
		throw new Error(
			`${context}: nilai nexu di luar rentang aman (${String(value)}). ` +
				`Harus bilangan bulat antara 0 dan MAX_SUPPLY_NEXU=` +
				`${MAX_SUPPLY_NEXU} (${(MAX_SUPPLY_NEXU / 100_000_000).toLocaleString('en-US')} NXC).`,
		)
	}
}
