import { setRpcUrl, getRpcUrl } from 'client/rpc-client/lib/rpcClient'

/**
 * Persistensi URL RPC di browser.
 *
 * Prioritas endpoint (dari yang paling bisa diubah):
 *   1. `localStorage`      — override manual via Settings (per-origin).
 *   2. `VITE_RPC_URL`      — di-bake saat BUILD (deploy VPS/devnet online).
 *   3. Ikut hostname halaman — fallback dev lokal (lihat defaultRpcUrl).
 *
 * Default node semula hardcode `http://localhost:8000/rpc` (BUG-E4) — dari HP
 * itu berarti HP itu sendiri. `initRpcUrl` dipanggil SEBELUM request pertama
 * (main.tsx); `setRpcUrl` sendiri menolak selain http(s).
 */
const STORAGE_KEY = 'nex_rpc_url'
const RPC_PORT = 8000

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
 * 1. `VITE_RPC_URL` (build-time) — halaman https PASTI diblokir bila fetch
 *    http ke port lain (mixed content), jadi deploy wajib mengisi env ini.
 * 2. Halaman https TANPA env → origin yang sama (`/rpc`), minimal boleh
 *    sampai ke proxy sebelum gagal — daripada URL yang pasti diblokir.
 * 3. Fallback dev lokal: ikut HOST HALAMAN, bukan `localhost` (BUG-E4):
 *      halaman http://192.168.90.100:5174 → http://192.168.90.100:8000/rpc
 *      halaman http://localhost:5174      → http://localhost:8000/rpc
 */
const defaultRpcUrl = (): string => {
	const fromEnv = envRpcUrl()
	if (fromEnv) return fromEnv

	if (typeof location === 'undefined') return `http://localhost:${RPC_PORT}/rpc`

	if (location.protocol === 'https:') return `${location.origin}/rpc`

	const host = location.hostname
	// loopback (IPv4 maupun IPv6 — hostname IPv6 datang dengan kurung siku)
	if (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '[::1]' ||
		host === '::1'
	) {
		return `http://localhost:${RPC_PORT}/rpc`
	}
	return `http://${host}:${RPC_PORT}/rpc`
}

export const initRpcUrl = (): void => {
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

export { getRpcUrl }
