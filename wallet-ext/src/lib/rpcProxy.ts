/**
 * Transport RPC — memindahkan `fetch` ke SERVICE WORKER.
 *
 * MASALAH YANG DIPECAHKAN
 *   Popup adalah halaman `chrome-extension://`. Setiap `fetch` dari popup
 *   tunduk pada CSP `extension_pages` → `connect-src`. Bila directive itu
 *   tidak cocok dengan host RPC (mis. node di IP LAN `192.168.x.x`), browser
 *   memblokir dengan "Refused to connect because it violates the document's
 *   Content Security Policy" — dan memperbaiki CSP-nya rapuh karena Chrome
 *   meng-cache manifest sampai extension di-reload.
 *
 *   Di SERVICE WORKER, permintaan lintas-origin diatur oleh `host_permissions`
 *   (manifest), BUKAN `connect-src`. Jadi memindahkan fetch ke sana membuat
 *   koneksi RPC tidak lagi bergantung pada CSP halaman.
 *
 * CARA PAKAI
 *   `lib/rpcClientTransport.ts` (atau modul setara) memanggil
 *   `setFetchTransport()` sekali saat boot di konteks extension. Setelah itu
 *   SEMUA `fetch` yang dilakukan modul RPC dialihkan ke service worker.
 *
 *   Di dev (bukan extension) atau bila service worker tidak tersedia,
 *   transport ini GAGAL dan pemanggil otomatis memakai `fetch` langsung —
 *   jadi tidak ada regresi untuk `bun run dev`.
 */

/** Pesan yang dipahami service worker. */
export interface RpcProxyRequest {
	type: 'NEX_RPC_FETCH'
	url: string
	init: {
		method: string
		headers: Record<string, string>
		body: string
	}
}

export interface RpcProxyResult {
	ok: boolean
	status?: number
	statusText?: string
	body?: string
	error?: string
}

const PING_TIMEOUT_MS = 2_000
const FETCH_TIMEOUT_MS = 15_000

/** Apakah kita berada di konteks extension dengan API messaging? */
const canUseServiceWorker = (): boolean =>
	typeof chrome !== 'undefined' &&
	!!chrome.runtime?.sendMessage &&
	// Service worker TIDAK bisa memanggil dirinya sendiri; bila kode ini
	// kebetulan dieksekusi di dalam SW, langsung tolak.
	typeof window !== 'undefined'

/** Balapan promise dengan batas waktu. */
const withTimeout = <T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${label} tidak merespons dalam ${ms}ms`)),
			ms,
		)
		promise.then(
			(v) => {
				clearTimeout(timer)
				resolve(v)
			},
			(e) => {
				clearTimeout(timer)
				reject(e)
			},
		)
	})

/**
 * Jalankan satu request RPC lewat service worker.
 *
 * @throws bila service worker tidak ada / tidak menjawab / melaporkan error.
 *         Pemanggil bertanggung jawab fallback ke `fetch` langsung.
 */
export const rpcFetchViaServiceWorker = async (
	url: string,
	init: RequestInit,
): Promise<Response> => {
	if (!canUseServiceWorker()) {
		throw new Error('Service worker tidak tersedia di konteks ini.')
	}

	const headers: Record<string, string> = {}
	const rawHeaders = init.headers
	if (rawHeaders instanceof Headers) {
		rawHeaders.forEach((value, key) => {
			headers[key] = value
		})
	} else if (Array.isArray(rawHeaders)) {
		for (const [key, value] of rawHeaders) headers[key] = String(value)
	} else if (rawHeaders) {
		for (const [key, value] of Object.entries(
			rawHeaders as Record<string, string>,
		)) {
			headers[key] = String(value)
		}
	}

	const message: RpcProxyRequest = {
		type: 'NEX_RPC_FETCH',
		url,
		init: {
			method: init.method ?? 'GET',
			headers,
			body: typeof init.body === 'string' ? init.body : '',
		},
	}

	const result = (await withTimeout(
		chrome.runtime.sendMessage(message),
		FETCH_TIMEOUT_MS,
		'Service worker RPC',
	)) as RpcProxyResult | undefined

	if (!result) {
		throw new Error('Service worker tidak membalas permintaan RPC.')
	}
	if (!result.ok) {
		throw new Error(result.error ?? 'Service worker gagal melakukan RPC.')
	}

	// Bangun ulang `Response` agar pemanggil (json-rpc-2.0) tidak perlu tahu
	// bahwa aslinya lewat service worker.
	return new Response(result.body ?? '', {
		status: result.status ?? 200,
		statusText: result.statusText ?? '',
		headers: { 'content-type': 'application/json' },
	})
}

/**
 * Cek cepat apakah service worker hidup dan mau melayani proxy RPC.
 *
 * Dipanggil sekali saat boot supaya keputusan "pakai SW atau fetch langsung"
 * diambil setelah fakta, bukan berdasarkan asumsi.
 */
export const probeServiceWorkerRpc = async (): Promise<boolean> => {
	if (!canUseServiceWorker()) return false
	try {
		const response = (await withTimeout(
			chrome.runtime.sendMessage({ type: 'NEX_PING' }),
			PING_TIMEOUT_MS,
			'Service worker ping',
		)) as { ok?: boolean } | undefined
		return response?.ok === true
	} catch {
		return false
	}
}
