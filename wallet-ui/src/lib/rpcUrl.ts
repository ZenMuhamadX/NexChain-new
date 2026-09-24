import { setRpcUrl, getRpcUrl } from 'client/rpc-client/lib/rpcClient'

/**
 * Persistensi URL RPC di browser.
 *
 * Default node adalah `http://localhost:8000/rpc` (BUG-E4). Wallet yang
 * di-deploy perlu menunjuk node lain tanpa rebuild, jadi override disimpan di
 * `localStorage` dan dipasang SEBELUM request pertama (`initRpcUrl` di
 * main.tsx). `setRpcUrl` sendiri menolak selain http(s).
 */
const STORAGE_KEY = 'nex_rpc_url'
const RPC_PORT = 8000

/**
 * Endpoint default yang mengikuti HOST HALAMAN, bukan `localhost`.
 *
 * Kenapa: `http://localhost:8000/rpc` dari HP berarti HP itu sendiri, sehingga
 * tiap refresh langsung gagal (`TypeError: Load failed`) dan muncul banner
 * `RPC: load failed`. Node-nya jalan di mesin yang sama dengan halaman, jadi
 * host-nya harus disalin dari `location.hostname`:
 *
 *   halaman http://192.168.90.100:5174 → http://192.168.90.100:8000/rpc
 *   halaman http://localhost:5174      → http://localhost:8000/rpc
 */
const defaultRpcUrl = (): string => {
	if (typeof location === 'undefined') return `http://localhost:${RPC_PORT}/rpc`
	const host = location.hostname
	// loopback (IPv4 maupun IPv6 — hostname IPv6 datang dengan kurung siku)
	if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
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
