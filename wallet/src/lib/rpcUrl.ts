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
// Kredensial Basic Auth method tulis — opsional, hanya dipakai bila node
// menyetel RPC_USER/RPC_PASSWORD. Kunci terpisah dari URL supaya menyimpan
// auth tidak ikut mengubah endpoint (dan sebaliknya).
const USER_KEY = 'nex_rpc_user'
const PASS_KEY = 'nex_rpc_pass'

/** Node publik default — pengguna tetap bisa menggantinya di Pengaturan. */
export const DEFAULT_RPC_URL = 'https://node1.zuns.my.id/rpc'

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
	// Kredensial pernah disimpan di localStorage (terbaca skrip lain di origin
	// yang sama, dan bertahan setelah aplikasi ditutup). Buang sisa lamanya:
	// sejak sekarang password hanya hidup selama satu sesi (sessionStorage).
	try {
		localStorage.removeItem(USER_KEY)
		localStorage.removeItem(PASS_KEY)
	} catch {
		// localStorage diblokir → tidak ada yang perlu dibersihkan
	}

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
 * Disimpan di `sessionStorage`, BUKAN `localStorage`: password node tidak
 * boleh bertahan di perangkat setelah aplikasi ditutup, dan tidak boleh
 * terbaca oleh skrip lain di origin yang sama kapan pun. Konsekuensinya user
 * mengetik ulang password tiap sesi bila node memakai auth — itu disengaja.
 *
 * `"kosong"` berarti tidak ada kredensial → request dikirim TANPA header
 * `Authorization`, persis perilaku lama (node dev lokal tanpa auth).
 */
export const getRpcCredentials = (): RpcCredentials => {
	try {
		return {
			user: sessionStorage.getItem(USER_KEY) ?? '',
			password: sessionStorage.getItem(PASS_KEY) ?? '',
		}
	} catch {
		// sessionStorage diblokir (private mode) → perlakukan sebagai tanpa auth
		return { user: '', password: '' }
	}
}

/**
 * Simpan kredensial dari layar Settings (keduanya kosong = hapus).
 *
 * Nilai disimpan apa adanya (di-trim) walaupun baru satu yang terisi, supaya
 * user tidak kehilangan input saat mengisi kolom satu per satu; header Basic
 * baru dibentuk bila KEDUANYA terisi (sama dengan aturan server). Hanya
 * `sessionStorage` — lihat `getRpcCredentials`.
 */
export const persistRpcCredentials = (user: string, password: string): void => {
	const trimmedUser = user.trim()
	const trimmedPassword = password.trim()
	try {
		if (!trimmedUser && !trimmedPassword) {
			sessionStorage.removeItem(USER_KEY)
			sessionStorage.removeItem(PASS_KEY)
			return
		}
		sessionStorage.setItem(USER_KEY, trimmedUser)
		sessionStorage.setItem(PASS_KEY, trimmedPassword)
	} catch {
		// gagal persist bukan gagal koneksi; berlaku untuk sesi ini saja
	}
}

export interface RpcConnectionResult {
	ok: boolean
	chainId?: number
	error?: string
}

/** Lightweight connection probe used by Settings without changing the active client. */
export const testRpcUrl = async (
	value: string,
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
		return { ok: true, chainId: body.result }
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
