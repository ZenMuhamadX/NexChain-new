import { setRpcUrl, getRpcUrl } from 'src/client/rpc-client/lib/rpcClient'
import { errorMessage } from './format'

/**
 * Persistensi URL RPC di browser.
 *
 * Prioritas endpoint (dari yang paling bisa diubah):
 *   1. `localStorage`      — override manual via Settings (per-origin).
 *   2. `VITE_RPC_URL`      — di-bake saat BUILD (deploy khusus satu node).
 *   3. `DEFAULT_RPC_URL`   — node publik NexChain (lihat di bawah).
 *
 * `initRpcUrl` dipanggil SEBELUM request pertama (main.tsx); `setRpcUrl`
 * sendiri menolak selain http(s).
 */
const STORAGE_KEY = 'nex_rpc_url'
// Kredensial Basic Auth method tulis — dipakai bila node menyetel
// RPC_USER/RPC_PASSWORD. Kunci terpisah dari URL supaya menyimpan auth tidak
// ikut mengubah endpoint (dan sebaliknya).
const USER_KEY = 'nex_rpc_user'
const PASS_KEY = 'nex_rpc_pass'

/** Node publik default — pengguna tetap bisa menggantinya di Pengaturan. */
export const DEFAULT_RPC_URL = 'https://node1.zuns.my.id/rpc'

/**
 * Kredensial bawaan build — BUKAN rahasia.
 *
 * Node publik NexChain memakai satu pasangan kredensial bersama untuk semua
 * pengguna wallet; ia penyaring bot, bukan pembatas keamanan. Nilainya ikut
 * terbundel di JS publik, jadi siapa pun yang membuka bundle bisa membacanya.
 * Yang benar-benar menahan penyalahgunaan adalah rate limiter node dan fakta
 * bahwa transaksi tetap harus bertanda tangan sah untuk memindahkan dana.
 *
 * Konsekuensi desain: TIDAK ADA gunanya menyimpan nilai ini terenkripsi —
 * enkripsi hanya menambah langkah dekripsi tanpa menutup satu pun jalur baca.
 * Karena itu kredensial disimpan apa adanya di `localStorage` (lihat
 * `persistRpcCredentials`) dan nilai di bawah dipakai saat belum ada simpanan.
 *
 * Ganti lewat `wallet/.env` (`VITE_RPC_USER` / `VITE_RPC_PASS`) bila node
 * publik mengganti kredensialnya; keduanya di-bake saat build.
 */
const DEFAULT_RPC_USER = 'nexchain'
const DEFAULT_RPC_PASSWORD = 'nexchain'

/** Env build-time yang terisi, atau `undefined` bila kosong/bukan string. */
const envCredential = (raw: unknown): string | undefined => {
	if (typeof raw !== 'string') return undefined
	const trimmed = raw.trim()
	return trimmed ? trimmed : undefined
}

/**
 * Kredensial bawaan: `VITE_RPC_USER`/`VITE_RPC_PASS` bila diisi, selain itu
 * pasangan bawaan di atas.
 */
export const defaultRpcCredentials = (): RpcCredentials => ({
	user: envCredential(import.meta.env.VITE_RPC_USER) ?? DEFAULT_RPC_USER,
	password: envCredential(import.meta.env.VITE_RPC_PASS) ?? DEFAULT_RPC_PASSWORD,
})

/**
 * `VITE_RPC_URL` bila terisi DAN valid http(s), selain itu `undefined`.
 *
 * Divalidasi di sini (bukan lewat setRpcUrl) supaya salah ketik di .env tidak
 * membuat RPC mati total — nilai rusak diabaikan dan sistem jatuh ke fallback
 * hostname, bukan melempar error saat boot.
 */
const envRpcUrl = (): string | undefined => {
	const raw = import.meta.env.VITE_RPC_URL
	if (typeof raw !== 'string') return undefined
	const trimmed = raw.trim()
	if (!trimmed) return undefined
	try {
		const parsed = new URL(trimmed)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
			? trimmed
			: undefined
	} catch {
		return undefined
	}
}

/**
 * Endpoint default.
 *
 * `VITE_RPC_URL` (build-time) menang bila diisi — dipakai untuk build yang
 * harus menunjuk satu node tertentu. Selain itu wallet memakai node publik;
 * pengguna bisa menggantinya kapan saja di Pengaturan (`persistRpcUrl`).
 */
const defaultRpcUrl = (): string => envRpcUrl() ?? DEFAULT_RPC_URL

export const initRpcUrl = (): void => {
	/*
	 * Catatan kebijakan: di sini dulu ada penghapusan `nex_rpc_user` /
	 * `nex_rpc_pass` dari localStorage setiap boot, karena kredensial pernah
	 * dianggap rahasia yang tidak boleh bertahan di perangkat.
	 *
	 * Itu dibalik dengan sengaja. Kredensial node publik dibagikan ke semua
	 * pengguna wallet dan ikut terbundel di JS publik, jadi menghapusnya dari
	 * perangkat tidak menutup apa pun — sementara efek sampingnya nyata: di
	 * PWA, sessionStorage mati bersama aplikasi, sehingga pengguna harus
	 * mengetik ulang password setiap kali membuka wallet.
	 */
	try {
		const saved = localStorage.getItem(STORAGE_KEY)
		if (saved) {
			setRpcUrl(saved)
			return
		}
	} catch {
		// localStorage bisa diblokir (private mode) → tetap pakai default.
	}
	try {
		setRpcUrl(defaultRpcUrl())
	} catch {
		// hostname aneh → biarkan default `localhost` dari rpcClient.
	}
}

export const persistRpcUrl = (url: string): void => {
	setRpcUrl(url) // melempar bila bukan http(s) — biarkan caller menampilkan
	try {
		localStorage.setItem(STORAGE_KEY, url.trim())
	} catch {
		// gagal persist bukan gagal koneksi; URL tetap berlaku untuk sesi ini
	}
}

export interface RpcCredentials {
	user: string
	password: string
}

/**
 * Kredensial Basic Auth untuk method tulis
 * (`nex_sendRawTransaction` — lihat `lib/rpc.ts`).
 *
 * Urutan: `localStorage` → bawaan build (`defaultRpcCredentials`). Jadi kolom
 * di Pengaturan tidak pernah kosong pada instalasi baru, dan nilai yang diubah
 * pengguna bertahan setelah aplikasi ditutup — termasuk di PWA, yang
 * `sessionStorage`-nya mati setiap kali aplikasi dihentikan.
 *
 * `"kosong"` pada keduanya berarti "pakai bawaan", bukan "tanpa auth": node
 * tanpa `RPC_USER` mengabaikan header `Authorization` sepenuhnya, jadi
 * mengirimkannya tidak berbahaya dan tidak ada jalan buntu.
 */
export const getRpcCredentials = (): RpcCredentials => {
	const fallback = defaultRpcCredentials()
	try {
		return {
			user: localStorage.getItem(USER_KEY) ?? fallback.user,
			password: localStorage.getItem(PASS_KEY) ?? fallback.password,
		}
	} catch {
		// localStorage diblokir (private mode) → pakai bawaan build
		return fallback
	}
}

/**
 * Simpan kredensial dari layar Settings (keduanya kosong = kembali ke bawaan).
 *
 * Nilai disimpan apa adanya (di-trim) walaupun baru satu yang terisi, supaya
 * user tidak kehilangan input saat mengisi kolom satu per satu; header Basic
 * baru dibentuk bila KEDUANYA terisi (sama dengan aturan server).
 */
export const persistRpcCredentials = (user: string, password: string): void => {
	const trimmedUser = user.trim()
	const trimmedPassword = password.trim()
	try {
		if (!trimmedUser && !trimmedPassword) {
			localStorage.removeItem(USER_KEY)
			localStorage.removeItem(PASS_KEY)
			return
		}
		localStorage.setItem(USER_KEY, trimmedUser)
		localStorage.setItem(PASS_KEY, trimmedPassword)
	} catch {
		// gagal persist bukan gagal koneksi; berlaku untuk sesi ini saja
	}
}

/**
 * Hasil uji kredensial dari probe tulis.
 *
 * `not-needed` = node membalas 403, artinya ia TIDAK menyetel
 * `RPC_USER`/`RPC_PASSWORD` dan hanya menerima method tulis dari loopback.
 * Kredensial yang diisi tidak dipakai, bukan ditolak.
 */
export type RpcAuthProbe = 'ok' | 'rejected' | 'not-needed' | 'unknown' | 'skipped'

export interface RpcConnectionResult {
	ok: boolean
	chainId?: number
	auth?: RpcAuthProbe
	error?: string
}

/**
 * Header Basic Auth dari kredensial apa pun.
 *
 * `btoa` hanya menerima Latin-1, jadi string-nya di-encode UTF-8 lebih dulu —
 * password non-ASCII tidak membuatnya melempar. Salinan kecil dari
 * `basicAuthHeader()` di `lib/rpc.ts`; tidak diimpor dari sana karena modul
 * itu sendiri mengimpor berkas ini (siklus).
 */
const encodeBasic = (user: string, password: string): string => {
	const bytes = new TextEncoder().encode(`${user}:${password}`)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return `Basic ${btoa(binary)}`
}

/**
 * Buktikan kredensialnya benar dengan method TULIS khusus uji.
 *
 * KENAPA perlu: `nex_getChainId` adalah method BACA, dan method baca tidak
 * pernah meminta autentikasi (`src/rpc/authLogic.ts`). Tanpa langkah ini,
 * password yang salah tetap ditampilkan "Terhubung", dan baru ketahuan saat
 * transaksi pertama gagal 401 — jauh setelah pengguna mengira semuanya beres.
 *
 * KENAPA bukan `nex_getWork`: method itu menyusun template blok dan membuat
 * job mining yang harus menunggu TTL untuk kedaluwarsa. `nex_authCheck`
 * (ditambahkan di `src/rpc/method.ts`) tidak mengerjakan apa pun — ia ada
 * hanya supaya middleware auth memberi jawaban 401/403/200 atas kredensial.
 *
 * Balasan apa pun selain 401 membuktikan middleware auth meloloskan
 * kredensial; error JSON-RPC bukan kegagalan auth.
 */
const probeWriteAuth = async (
	url: string,
	credentials: RpcCredentials | undefined,
): Promise<RpcAuthProbe> => {
	if (!credentials?.user || !credentials?.password) return 'skipped'

	const controller = new AbortController()
	const timeout = window.setTimeout(() => controller.abort(), 8_000)
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: encodeBasic(credentials.user, credentials.password),
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'nex_authCheck',
				params: {},
			}),
			signal: controller.signal,
		})
		if (response.status === 401) return 'rejected'
		if (response.status === 403) return 'not-needed'
		return response.ok ? 'ok' : 'unknown'
	} catch {
		return 'unknown'
	} finally {
		window.clearTimeout(timeout)
	}
}

/** Lightweight connection probe used by Settings without changing the active client. */
export const testRpcUrl = async (
	value: string,
	credentials?: RpcCredentials,
): Promise<RpcConnectionResult> => {
	let parsed: URL
	try {
		parsed = new URL(value.trim())
	} catch {
		return { ok: false, error: 'URL RPC tidak valid.' }
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return { ok: false, error: 'URL RPC harus diawali http:// atau https://.' }
	}

	const controller = new AbortController()
	const timeout = window.setTimeout(() => controller.abort(), 8_000)
	try {
		const response = await fetch(parsed.toString(), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nex_getChainId' }),
			signal: controller.signal,
		})
		if (!response.ok)
			return { ok: false, error: `Node membalas HTTP ${response.status}.` }
		const body = (await response.json()) as {
			result?: number
			error?: { message?: string }
		}
		if (body.error)
			return { ok: false, error: body.error.message ?? 'Node menolak probe.' }
		if (typeof body.result !== 'number')
			return { ok: false, error: 'Respons chain ID tidak valid.' }

		const auth = await probeWriteAuth(parsed.toString(), credentials)
		if (auth === 'rejected') {
			return {
				ok: false,
				chainId: body.result,
				auth,
				error:
					'Node menolak kredensial RPC (HTTP 401). Periksa RPC Username/Password — tanpa ini transaksi tidak bisa dikirim.',
			}
		}
		return { ok: true, chainId: body.result, auth }
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof DOMException && error.name === 'AbortError'
					? 'Node tidak merespons dalam 8 detik.'
					: errorMessage(error),
		}
	} finally {
		window.clearTimeout(timeout)
	}
}

export { getRpcUrl }
