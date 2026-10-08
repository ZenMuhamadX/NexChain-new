import { setRpcUrl, getRpcUrl } from 'src/client/rpc-client/lib/rpcClient'
import { errorMessage } from './format'

/**
 * Persistensi URL RPC di browser (pola sama dengan wallet-ui).
 *
 * Prioritas endpoint:
 *   1. `localStorage`       — override manual via Settings.
 *   2. `VITE_RPC_URL`       — di-bake saat BUILD (deploy VPS/devnet online).
 *   3. Ikut hostname halaman — fallback dev lokal.
 *
 * Catatan penting: halaman HTTPS TIDAK boleh fetch ke RPC http (mixed
 * content diblokir browser), jadi deploy wajib mengisi `VITE_RPC_URL`
 * atau menaruh node di balik proxy HTTPS.
 */
const STORAGE_KEY = 'nex_miner_rpc_url'
const RPC_PORT = 8000

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

const defaultRpcUrl = (): string => {
	const fromEnv = envRpcUrl()
	if (fromEnv) return fromEnv

	if (typeof location === 'undefined') return `http://localhost:${RPC_PORT}/rpc`

	if (location.protocol === 'https:') return `${location.origin}/rpc`

	const host = location.hostname
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
		// gagal persist bukan gagal koneksi; URL tetap berlaku sesi ini
	}
}

export interface RpcConnectionResult {
	ok: boolean
	chainId?: number
	error?: string
}

/**
 * Probe koneksi ringan TANPA mengubah client aktif — dipakai layar
 * Settings supaya user bisa memvalidasi URL sebelum menyimpannya.
 */
export const testRpcUrl = async (value: string): Promise<RpcConnectionResult> => {
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
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'nex_getChainId',
			}),
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
