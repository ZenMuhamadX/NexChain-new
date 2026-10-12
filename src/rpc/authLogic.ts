/**
 * Logika keamanan RPC — MURNI (tanpa express, tanpa I/O, tanpa side effect).
 *
 * Dipakai tiga tempat dengan keputusan yang SAMA supaya tidak mungkin berbeda:
 *   1. `src/rpc/middleware/auth.ts` — middleware per-request;
 *   2. `apps/node/server.ts`        — pemeriksaan saat boot (gagal-start);
 *   3. `scripts/rpcSecurityCheck.ts` — gate offline `bun run check:rpc`.
 *
 * Kenapa murni: keputusan auth adalah tempat paling mudah terjadi regresi
 * senyap (baca "read" sebagai "write", salah loopback, dst). Dengan fungsi
 * murni, semua kasus itu diuji tanpa membuka server, LevelDB, atau port.
 *
 * Aturan ringkas:
 *   - Method TULIS (`WRITE_METHODS`) wajib autentikasi; method BACA tidak.
 *   - Kredensial tersedia (RPC_USER + RPC_PASSWORD keduanya terisi):
 *     wajib HTTP Basic yang BENAR — salah / kosong / rusak → 401 +
 *     `WWW-Authenticate`.
 *   - Kredensial TIDAK tersedia: method tulis hanya boleh dari loopback,
 *     selain itu → 403 (bukan 401: tidak ada kredensial yang bisa divalidasi).
 *   - Boot: bind NON-loopback tanpa kredensial = node MENOLAK hidup.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Method yang MENULIS state atau memicu kerja berat.
 *
 * Sengaja daftarnya eksplisit — method baru yang menulis state harus
 * ditambahkan di sini, kalau tidak ia masuk kategori "baca" tanpa auth.
 */
export const WRITE_METHODS: readonly string[] = [
	'nex_sendTransaction',
	'nex_sendRawTransaction',
	'nex_getWork',
	'nex_submitWork',
]

/** `true` bila `method` termasuk method tulis. */
export const isWriteMethod = (method: unknown): boolean =>
	typeof method === 'string' && WRITE_METHODS.includes(method)

/**
 * Ekstrak SEMUA nilai `method` dari body JSON-RPC.
 *
 *   - objek tunggal → `[body.method]`
 *   - batch (array) → method tiap entri
 *   - body non-objek / entri rusak → diabaikan (route sudah menolaknya;
 *     ini pertahanan-dalam-dalam, bukan validasi utama)
 *
 * Batch harus ikut diperiksa: `json-rpc-2.0` `receive()` mengeksekusi entri
 * batch lewat `Promise.all`, jadi SATU request HTTP bisa memuat banyak
 * method tulis.
 */
export const extractMethods = (body: unknown): string[] => {
	const methods: string[] = []
	const take = (entry: unknown): void => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
		const method = (entry as Record<string, unknown>).method
		if (typeof method === 'string') methods.push(method)
	}
	if (Array.isArray(body)) {
		for (const entry of body) take(entry)
		return methods
	}
	take(body)
	return methods
}

/**
 * Loopback yang dikenali Express/Bun untuk koneksi lokal.
 * `127.0.0.0/8` seluruhnya loopback (RFC 1122), jadi `127.*` ikut diterima —
 * berguna bila runtime memakai 127.0.0.2 dsb.
 */
const LOOPBACK_EXACT = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** `true` bila alamat remote adalah loopback mesin ini sendiri. */
export const isLoopbackAddress = (address: string): boolean => {
	const normalized = address.trim().toLowerCase()
	if (normalized.length === 0) return false
	return LOOPBACK_EXACT.has(normalized) || normalized.startsWith('127.')
}

/** Kredensial dianggap "tersedia" hanya bila KEDUANYA terisi (bukan whitespace). */
export const hasConfiguredCredentials = (
	user: string | undefined,
	password: string | undefined,
): boolean =>
	typeof user === 'string' &&
	user.trim().length > 0 &&
	typeof password === 'string' &&
	password.trim().length > 0

/**
 * Bandingkan dua string tanpa membocorkan panjang waktu lewat panjang
 * perbandingan: keduanya di-hash dulu (SHA-256 → 32 byte tetap) baru
 * `timingSafeEqual`. Hash juga menetralkan perbedaan encoding/panjang.
 *
 * `node:crypto` di sini aman — modul ini hanya dijalankan Node/Bun (server
 * & gate), TIDAK pernah di-bundle ke browser.
 */
const timingSafeStringEqual = (a: string, b: string): boolean => {
	const digestA = createHash('sha256').update(a, 'utf8').digest()
	const digestB = createHash('sha256').update(b, 'utf8').digest()
	return timingSafeEqual(digestA, digestB)
}

/**
 * Parse header `Authorization: Basic <base64(user:pass)>`.
 * `null` untuk header kosong/salah format/salah skema/tanpa `:`
 * — semuanya diperlakukan sama: tidak ada kredensial yang bisa dipercaya.
 */
const parseBasicAuthorization = (
	header: string | undefined,
): { user: string; password: string } | null => {
	if (typeof header !== 'string') return null
	const match = /^Basic\s+([A-Za-z0-9+/]{4,}={0,2})$/i.exec(header.trim())
	if (!match) return null
	const decoded = Buffer.from(match[1], 'base64').toString('utf8')
	const separator = decoded.indexOf(':')
	if (separator < 0) return null
	return {
		user: decoded.slice(0, separator),
		password: decoded.slice(separator + 1),
	}
}

/** Keputusan auth untuk SATU request HTTP (satu request bisa berisi batch). */
export type RpcAuthDecision =
	{ ok: true } | { ok: false; status: 401 | 403; challenge?: true }

/**
 * Keputusan auth murni.
 *
 * @param methodsInRequest       semua method dalam body (lihat `extractMethods`)
 * @param authorizationHeader    header `Authorization` apa adanya (boleh kosong)
 * @param remoteAddress          alamat remote KONEKSI (bukan header spoofable)
 * @param configuredUser         `RPC_USER` (opsional)
 * @param configuredPassword     `RPC_PASSWORD` (opsional)
 */
export const evaluateRpcAuth = (
	methodsInRequest: string[],
	authorizationHeader: string | undefined,
	remoteAddress: string,
	configuredUser: string | undefined,
	configuredPassword: string | undefined,
): RpcAuthDecision => {
	// Request baca-saja: selalu lolos. Kredensial memang diset tapi tidak
	// dikirim pun tidak apa-apa — membaca hanya data rantai publik.
	if (!methodsInRequest.some(isWriteMethod)) return { ok: true }

	// ---- Kredensial tersedia: wajib Basic yang benar -------------------
	if (hasConfiguredCredentials(configuredUser, configuredPassword)) {
		const parsed = parseBasicAuthorization(authorizationHeader)
		// Header hilang, rusak, atau bukan Basic → 401 + tantangan.
		if (!parsed) return { ok: false, status: 401, challenge: true }
		const userOk = timingSafeStringEqual(parsed.user, configuredUser!)
		const passwordOk = timingSafeStringEqual(
			parsed.password,
			configuredPassword!,
		)
		return userOk && passwordOk
			? { ok: true }
			: { ok: false, status: 401, challenge: true }
	}

	// ---- Kredensial tidak diset: method tulis hanya dari loopback -----
	return isLoopbackAddress(remoteAddress)
		? { ok: true }
		: { ok: false, status: 403 }
}

/** Hasil pemeriksaan bind-vs-kredensial saat node akan start. */
export type BindAuthVerdict =
	{ ok: true; warning: string } | { ok: false; message: string }

/** Host bind yang hanya menerima koneksi mesin ini sendiri. */
export const isLoopbackBind = (bindHost: string): boolean => {
	const normalized = bindHost.trim().toLowerCase()
	if (normalized === 'localhost' || normalized === '::1') return true
	if (normalized === '::ffff:127.0.0.1') return true
	// `0.0.0.0` / `::` / IP LAN → SEMUA interface, bukan loopback.
	return normalized.startsWith('127.')
}

/**
 * Pemeriksaan boot: bind non-loopback TANPA kredensial = node menolak hidup.
 *
 * Alasannya polos: tanpa kredensial, satu-satunya pagar method tulis adalah
 * alamat remote — dan di balik reverse proxy / docker bridge alamat itu
 * TERLIHAT loopback, jadi siapa pun yang bisa menembus proxy ikut lolos.
 * Lebih baik gagal keras di boot daripada berjalan dengan pagar yang bisa
 * dilewati tanpa terlihat.
 *
 * Loopback + tanpa kredensial = tetap boleh (dev lokal), tapi dengan
 * peringatan keras — lihat `warning`.
 */
export const checkBindAndAuth = (
	bindHost: string,
	user: string | undefined,
	password: string | undefined,
): BindAuthVerdict => {
	const creds = hasConfiguredCredentials(user, password)
	const partial =
		!creds &&
		((typeof user === 'string' && user.length > 0) ||
			(typeof password === 'string' && password.length > 0))

	if (isLoopbackBind(bindHost)) {
		if (creds) return { ok: true, warning: '' }
		return {
			ok: true,
			warning:
				`RPC bind ${bindHost} (loopback) tanpa RPC_USER/RPC_PASSWORD — ` +
				'method tulis (nex_sendTransaction, nex_sendRawTransaction, ' +
				'nex_getWork, nex_submitWork) hanya menerima koneksi loopback ' +
				'tanpa autentikasi. Catatan: DI BELAKANG PROXY WAJIB set ' +
				'kredensial, karena remote akan terlihat sebagai loopback.',
		}
	}

	if (partial) {
		return {
			ok: false,
			message:
				`RPC bind ${bindHost} TANPA kredensial lengkap — RPC_USER dan ` +
				'RPC_PASSWORD harus diisi KEDUANYA (atau kosongkan keduanya) ' +
				'supaya method tulis terproteksi Basic Auth. Bind 127.0.0.1 ' +
				'bila tidak butuh akses dari mesin lain.',
		}
	}
	if (!creds) {
		return {
			ok: false,
			message:
				`RPC bind ${bindHost} (non-loopback) TANPA RPC_USER/RPC_PASSWORD ` +
				'— menolak start. Set kredensial Basic Auth (disarankan) atau ' +
				'bind 127.0.0.1. Method tulis tanpa kredensial hanya aman ' +
				'untuk loopback.',
		}
	}
	return { ok: true, warning: '' }
}
