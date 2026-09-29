import { isNexuCapped } from './isNexuCapped'

/**
 * Validasi nilai on-chain dalam nexu.
 *
 * Delegasi ke `isNexuCapped`, sehingga sekaligus memverifikasi tiga hal:
 *
 *   1. bilangan bulat **aman** (`< 2^53`) — satu-satunya kondisi di mana
 *      aritmetika `number` dijamin eksak;
 *   2. tidak negatif;
 *   3. tidak melampaui plafon suplai 50 juta NXC.
 *
 * Sebelumnya hanya `Number.isInteger(value) && value >= 0` — tidak ada
 * pengaman plafon, dan `Number.isInteger(1e20)` justru `true` padahal
 * `1e20` sudah melewati batas aman sehingga `+`/`-` dibulatkan diam-diam.
 *
 * @param value Nilai dalam nexu.
 * @returns `true` bila aman disimpan di state dan boleh dikirim.
 */
export const isNexu = (value: number): boolean => isNexuCapped(value)
