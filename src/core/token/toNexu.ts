import { parseNxc } from './parseNxc'

/**
 * NXC → nexu, **tanpa operasi floating point**.
 *
 * Sebelumnya fungsi ini `nxc * Math.pow(10, 18)` yang menempuh jalur
 * IEEE-754: hasilnya tidak dijamin bilangan bulat. Contoh konkret dari
 * bug devnet `1e18 + 1 === 1e18` dan saldo `100.00049999999901 NXC`.
 *
 * Sekarang konversi dilakukan `parseNxc` — aritmetika string murni.
 * `toNexu(0.00025)` menghasilkan `25_000` **tepat**, di semua platform.
 *
 * @param nxc Nilai NXC berupa string (disarankan — tanpa pembulatan
 *            `Number()`) atau number (literal di kode).
 * @returns Nilai dalam nexu, bilangan bulat aman.
 * @throws Error bila bukan desimal yang bisa direpresentasikan utuh.
 *
 * @example
 * toNexu('0.00025')   // 25_000
 * toNexu('500')       // 50_000_000_000
 * toNexu(0.5)         // 50_000_000
 */
export const toNexu = (nxc: string | number): number => parseNxc(nxc)
