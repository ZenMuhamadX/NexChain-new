/**
 * Allowlist origin CORS untuk RPC — MURNI (tanpa express, tanpa I/O).
 *
 * Sebelumnya `origin: '*'` + `credentials: true` mengizinkan halaman mana
 * pun memanggil RPC dari browser korban. Allowlist membatasi itu ke UI
 * resmi yang memang diharapkan; kredensial tetap lewat header `Authorization`
 * (bukan cookie), jadi `credentials` TIDAK dinyalakan sama sekali.
 *
 * Dipakai oleh `src/rpc/app/app.ts` dan diuji offline oleh
 * `scripts/rpcSecurityCheck.ts` (`bun run check:rpc`).
 */

/**
 * Origin default — port dev Vite explorer (5173) / wallet (5174) /
 * miner-ui (5175) pada `localhost` DAN `127.0.0.1`.
 *
 * `"null"` ikut disertakan BUKAN karena lalai, tapi karena Electron desktop
 * wallet memuat renderer dari `file://` sehingga browser mengirim
 * `Origin: "null"`. Tanpa entri itu wallet desktop tidak bisa bicara sama
 * sekali dengan node lokal. Aman untuk tetap ada: tulisan tetap
 * terproteksi Basic Auth (lihat `src/rpc/authLogic.ts`), dan yang terbaca
 * hanya data rantai publik. Operator yang tidak butuh shell Electron boleh
 * membuang `"null"` dari `RPC_CORS_ORIGINS`.
 */
const DEFAULT_ORIGINS: readonly string[] = [
	'http://localhost:5173',
	'http://localhost:5174',
	'http://localhost:5175',
	'http://127.0.0.1:5173',
	'http://127.0.0.1:5174',
	'http://127.0.0.1:5175',
	'null',
]

/**
 * Parse `RPC_CORS_ORIGINS` (dipisah koma) menjadi daftar origin.
 *
 *   - tidak diset  → daftar default di atas
 *   - kosong/whitespace → juga daftar default (salah kosong tidak boleh
 *     membuat RPC tak bisa diakses UI mana pun)
 *   - terisi       → daftar itu SAJA (operator penuh kendali)
 */
export const parseCorsOrigins = (raw: string | undefined): string[] => {
	if (typeof raw !== 'string') return [...DEFAULT_ORIGINS]
	const list = raw
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
	return list.length > 0 ? list : [...DEFAULT_ORIGINS]
}

/**
 * Apakah `origin` diizinkan?
 *
 * `origin === undefined` = request TANPA header `Origin` (curl, Postman,
 * server-to-server, same-origin) — CORS adalah pertahanan browser terhadap
 * halaman lain, jadi tidak ada alamat yang harus dicek di sana; keputusan
 * auth tetap berlaku utuh di middleware auth.
 */
export const isOriginAllowed = (
	origin: string | undefined,
	allowed: readonly string[],
): boolean => {
	if (origin === undefined) return true
	return allowed.includes(origin)
}
