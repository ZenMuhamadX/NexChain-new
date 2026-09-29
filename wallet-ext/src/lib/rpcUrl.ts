import { setRpcUrl, getRpcUrl, setFetchTransport } from 'client/rpc-client/lib/rpcClient'
import { storageGet, storageSet } from './storage'
import { errorMessage } from './format'
import { probeServiceWorkerRpc, rpcFetchViaServiceWorker } from './rpcProxy'
import { traceNote, traceWarn } from './trace'

/**
 * Persistensi URL RPC untuk CHROME EXTENSION.
 *
 * PERBEDAAN dari wallet-ui:
 *   - `localStorage` → `chrome.storage.local` (lihat `lib/storage.ts`).
 *   - `initRpcUrl` menjadi ASYNC (dipanggil dengan `await` di popup entry).
 *   - Fallback "ikut hostname halaman" DIHAPUS: origin extension selalu
 *     `chrome-extension://<id>`, jadi hostname tidak bermakna. Default jatuh
 *     ke `VITE_RPC_URL` (build-time) atau localhost dev.
 *
 * Prioritas:
 *   1. override manual via Settings (chrome.storage)
 *   2. VITE_RPC_URL (di-bake saat build)
 *   3. http://localhost:8000/rpc (dev lokal)
 */
const STORAGE_KEY = 'rpc_url'
const RPC_PORT = 8000
const DEFAULT_RPC_URL = `http://localhost:${RPC_PORT}/rpc`

/**
 * `VITE_RPC_URL` bila terisi DAN valid http(s), selain itu `undefined`.
 * Divalidasi di sini supaya salah ketik di .env tidak membuat RPC mati total.
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

const defaultRpcUrl = (): string => envRpcUrl() ?? DEFAULT_RPC_URL

/** Dipanggil sekali saat boot popup, SEBELUM request pertama. */
export const initRpcUrl = async (): Promise<void> => {
	/**
	 * PENTING — pasang transport proxy RPC SEBELUM request apa pun.
	 *
	 * Popup adalah halaman `chrome-extension://`, jadi `fetch` darinya tunduk
	 * pada CSP `extension_pages` → `connect-src`. Bila node RPC ada di host
	 * yang tidak cocok dengan directive itu (mis. IP LAN `192.168.90.105`),
	 * browser memblokir dengan "Refused to connect because it violates the
	 * document's Content Security Policy".
	 *
	 * Service worker TIDAK terkena `connect-src`; di sana yang berlaku
	 * `host_permissions`. Jadi fetch dialihkan ke sana. Bila service worker
	 * tidak tersedia (dev server biasa), transport TIDAK dipasang dan jalur
	 * `fetch` langsung tetap dipakai.
	 */
	try {
		const swReady = await probeServiceWorkerRpc()
		if (swReady) {
			setFetchTransport(rpcFetchViaServiceWorker)
			traceNote('rpc: transport dialihkan ke service worker (lewati CSP popup)')
		} else {
			traceWarn(
				'rpc: service worker tidak siap — memakai fetch langsung ' +
					'(bisa diblokir CSP bila node di host lain)',
			)
		}
	} catch (error) {
		traceWarn('rpc: gagal memasang transport service worker', errorMessage(error))
	}

	try {
		const saved = await storageGet(STORAGE_KEY)
		if (saved) {
			setRpcUrl(saved)
			traceNote(`rpc: URL dari storage → ${saved}`)
			return
		}
	} catch {
		// storage tidak tersedia → tetap pakai default.
	}
	try {
		setRpcUrl(defaultRpcUrl())
		traceNote(`rpc: URL default → ${defaultRpcUrl()}`)
	} catch {
		// biarkan default bawaan `rpcClient`.
	}
}

export const persistRpcUrl = async (url: string): Promise<void> => {
	setRpcUrl(url) // melempar bila bukan http(s) — biarkan caller menampilkan
	await storageSet(STORAGE_KEY, url.trim())
}

export interface RpcConnectionResult {
	ok: boolean
	chainId?: number
	error?: string
}

/** Lightweight connection probe used by Settings without changing the active client. */
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
	const timeout = setTimeout(() => controller.abort(), 8_000)
	try {
		const response = await fetch(parsed.toString(), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nex_getChainId' }),
			signal: controller.signal,
		})
		if (!response.ok) return { ok: false, error: `Node membalas HTTP ${response.status}.` }
		const body = (await response.json()) as {
			result?: number
			error?: { message?: string }
		}
		if (body.error) return { ok: false, error: body.error.message ?? 'Node menolak probe.' }
		if (typeof body.result !== 'number') {
			return { ok: false, error: 'Respons chain ID tidak valid.' }
		}
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
		clearTimeout(timeout)
	}
}

export { getRpcUrl }
