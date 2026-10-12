/**
 * Buffer polyfill — HARUS import pertama di entry.
 *
 * `bip39` memanggil `Buffer.from`/`Buffer.isBuffer` dan global ini tidak ada
 * di browser; tanpa polyfill, create/import/unlock crash saat runtime meski
 * bundling lolos. Paket `buffer` (JS murni, tanpa Node API) dipaksa lewat
 * alias `^buffer$` di vite.config.ts.
 */
import { Buffer } from 'buffer'

const g = globalThis as { Buffer?: typeof Buffer }

if (typeof g.Buffer === 'undefined') {
	g.Buffer = Buffer
}
