/**
 * Background Service Worker (MV3).
 *
 * TANGGUNG JAWAB:
 *   1. Router pesan antara content script (dApp) ↔ UI extension.
 *   2. Membuka tab wallet penuh (`wallet.html`) untuk tugas berat.
 *   3. Menyiarkan perubahan preferensi antar konteks extension.
 *
 * CATATAN LIFECYCLE (tantangan MV3 yang sudah diidentifikasi):
 *   Service worker dapat DIMATIKAN browser setelah ~30 detik idle. Karena itu
 *   di sini kita TIDAK menyimpan state rahasia (private key / vault terbuka)
 *   di memori SW. Vault hidup di chrome.storage.local (persisten, terenkripsi), dan
 *   `unlock` dilakukan di konteks UI. Ini membuat behavior aman: SW tidur =
 *   tidak ada rahasia yang tertinggal di memori.
 *
 *   Konsekuensi yang perlu diingat: `openWalletTab()` di bawah memakai
 *   `chrome.tabs.create` yang tetap valid meski SW baru bangun — tidak ada
 *   state yang perlu dipulihkan.
 *
 *   Fase berikutnya (injeksi dApp) akan menambahkan approval queue di sini.
 */

const WALLET_PAGE = 'wallet.html'

/** Kontrak pesan minimal antara halaman/UI dan extension. */
interface ExtMessage {
	type: string
	payload?: unknown
}

const log = (...args: unknown[]): void => {
	console.log('[NexChain SW]', ...args)
}

// ---- Lifecycle ----

self.addEventListener('install', () => {
	log('service worker terpasang')
	// Aktifkan segera tanpa menunggu reload tab.
	void self.skipWaiting?.()
})

self.addEventListener('activate', (event) => {
	log('service worker aktif')
	;(event as ExtendableEvent).waitUntil(self.clients?.claim() ?? Promise.resolve())
})

/**
 * Buka `wallet.html` di tab baru, atau fokuskan tab yang sudah terbuka.
 *
 * Kenapa tidak selalu `chrome.tabs.create`: popup ditutup saat fokus pindah,
 * jadi mengklik "Buka di tab" dua kali akan menumpuk tab wallet kalau kita
 * tidak mencari yang sudah ada lebih dulu.
 */
const openWalletTab = async (): Promise<void> => {
	const url = chrome.runtime.getURL(WALLET_PAGE)
	const existing = await chrome.tabs.query({ url })
	const first = existing[0]
	if (first?.id !== undefined) {
		await chrome.tabs.update(first.id, { active: true })
		if (first.windowId !== undefined) {
			await chrome.windows.update(first.windowId, { focused: true })
		}
		return
	}
	await chrome.tabs.create({ url })
}

// ---- Message router ----

/** Batas ukuran body request RPC (sama seperti node; transaksi hex jauh di bawah ini). */
const MAX_RPC_BODY_BYTES = 512 * 1024

interface RpcFetchMessage {
	type: 'NEX_RPC_FETCH'
	url: string
	init: { method: string; headers: Record<string, string>; body: string }
}

interface RpcFetchResult {
	ok: boolean
	status?: number
	statusText?: string
	body?: string
	error?: string
}

/**
 * Lakukan `fetch` ke node RPC DARI service worker.
 *
 * See the `NEX_RPC_FETCH` case in the router for why this exists.
 */
const handleRpcFetch = async (
	message: RpcFetchMessage,
): Promise<RpcFetchResult> => {
	let parsed: URL
	try {
		parsed = new URL(message.url)
	} catch {
		return { ok: false, error: 'URL RPC tidak valid.' }
	}
	// Hanya http(s): menolak `javascript:`, `data:`, `file:` — mencegah
	// service worker dipakai sebagai vektor SSRF ke skema internal.
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return { ok: false, error: 'Hanya http/https yang diizinkan untuk RPC.' }
	}

	const body = message.init.body ?? ''
	if (body.length > MAX_RPC_BODY_BYTES) {
		return { ok: false, error: 'Body RPC terlalu besar.' }
	}

	try {
		const response = await fetch(parsed.toString(), {
			method: message.init.method || 'POST',
			headers: message.init.headers,
			body: message.init.method === 'GET' ? undefined : body,
		})
		const text = await response.text()
		return {
			ok: true,
			status: response.status,
			statusText: response.statusText,
			body: text,
		}
	} catch (error) {
		// Pesan diteruskan apa adanya supaya UI bisa menunjuk penyebab nyata
		// (DNS gagal, koneksi ditolak, host tak terjangkau).
		return {
			ok: false,
			error: `${parsed.toString()} tidak terjangkau: ${
				error instanceof Error ? error.message : String(error)
			}`,
		}
	}
}

chrome.runtime.onMessage.addListener(
	(message: ExtMessage, _sender, sendResponse: (r: unknown) => void) => {
		switch (message.type) {
			/**
			 * Probe kesehatan dari content script / popup.
			 * Selalu balas synchronous agar pemanggil tidak menggantung.
			 */
			case 'NEX_PING':
				sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
				return false

			/**
			 * "Buka di tab" dari popup. Halaman dijalankan pada konteks
			 * extension sendiri sehingga tidak butuh `tabs` permission untuk
			 * `create` dengan URL internal.
			 */
			case 'NEX_OPEN_WALLET':
				void openWalletTab()
					.then(() => sendResponse({ ok: true }))
					.catch((error: unknown) =>
						sendResponse({
							ok: false,
							error: error instanceof Error ? error.message : 'Gagal membuka tab.',
						}),
					)
				return true

			/**
			 * Titik masuk untuk permintaan provider dApp (EIP-1193-like).
			 * Implementasi penuh (approval UI + signing) menyusul di fase
			 * injeksi; untuk sekarang dibalas sebagai "belum diimplementasikan"
			 * supaya kontrak tidak berubah saat fitur ditambahkan.
			 */
			case 'NEX_REQUEST':
				log('NEX_REQUEST diterima (belum diimplementasikan):', message.payload)
				sendResponse({
					ok: false,
					error: 'Request handling belum diimplementasikan (fase injeksi dApp).',
				})
				return false

			/**
			 * PROXY RPC — alasan keberadaannya penting.
			 *
			 * Popup adalah halaman `chrome-extension://`, jadi setiap `fetch`
			 * darinya tunduk pada CSP `extension_pages` → `connect-src`. Bila
			 * node RPC berada di host yang tidak cocok dengan directive itu
			 * (mis. IP LAN `192.168.x.x`), browser memblokirnya. Memperbaiki
			 * CSP-nya rapuh: Chrome meng-cache manifest sampai extension
			 * di-reload, sehingga gejalanya bisa muncul kembali tanpa sebab
			 * yang jelas.
			 *
			 * Di SERVICE WORKER, koneksi lintas-origin diatur oleh
			 * `host_permissions` (manifest), BUKAN `connect-src`. Karena itu
			 * fetch dipindahkan ke sini dan popup hanya menerima hasilnya.
			 *
			 * KEAMANAN: hanya http(s) yang diizinkan (menolak `javascript:`,
			 * `data:`, `file:`). Body dibatasi ukurannya agar service worker
			 * tidak dipakai sebagai kanal transfer besar.
			 */
			case 'NEX_RPC_FETCH': {
				void handleRpcFetch(message as RpcFetchMessage)
					.then(sendResponse)
					.catch((error: unknown) =>
						sendResponse({
							ok: false,
							error:
								error instanceof Error ? error.message : 'RPC proxy gagal.',
						}),
					)
				return true
			}

			default:
				return false
		}
	},
)

log('service worker dimuat')
