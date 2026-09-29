/**
 * Content Script (MV3).
 *
 * Jembatan antara HALAMAN WEB (yang tidak punya akses ke API extension) dan
 * SERVICE WORKER extension:
 *
 *   halaman (inpage.js)  --window.postMessage-->  content.js
 *   content.js           --chrome.runtime.sendMessage-->  service worker
 *
 * Kenapa perlu dua lapis:
 *   - `inpage.js` HARUS jalan di "world" halaman agar bisa menempelkan
 *     `window.nexchain`; tapi di sana `chrome.*` TIDAK tersedia.
 *   - `content.js` punya akses `chrome.*` tetapi terisolasi dari variabel
 *     halaman — jadi ia hanya meneruskan pesan, tidak menyentuh objek wallet.
 *
 * Catatan keamanan: pesan dari halaman diperlakukan sebagai TIDAK TEPERCAYA.
 * Hanya `type` yang dikenali yang diteruskan; sisanya diabaikan.
 */

const INPAGE_URL = chrome.runtime.getURL('inpage.js')
const CHANNEL = 'nexchain-provider'
/** Suntikkan script inpage ke dunia halaman (sekali per document). */
const injectInpage = (): void => {
	const script = document.createElement('script')
	script.src = INPAGE_URL
	script.type = 'module'
	script.onload = () => script.remove()
	script.onerror = () => script.remove()
	const target = document.head || document.documentElement
	target.prepend(script)
}

injectInpage()

/** Teruskan request halaman → service worker → balas ke halaman. */
const forwardToBackground = (id: string, payload: unknown): void => {
	try {
		chrome.runtime.sendMessage({ type: 'NEX_REQUEST', payload }, (response) => {
			window.postMessage(
				{ channel: CHANNEL, kind: 'response', id, response },
				window.location.origin,
			)
		})
	} catch (error) {
		window.postMessage(
			{
				channel: CHANNEL,
				kind: 'response',
				id,
				response: {
					ok: false,
					error: error instanceof Error ? error.message : 'Extension bridge error',
				},
			},
			window.location.origin,
		)
	}
}

window.addEventListener('message', (event: MessageEvent) => {
	// 1. Hanya terima pesan dari halaman yang sama.
	if (event.source !== window) return
	// 2. Hanya terima pesan dengan channel yang kita kenal.
	const data = event.data as
		| { channel?: string; kind?: string; id?: string; payload?: unknown }
		| undefined
	if (!data || data.channel !== CHANNEL || data.kind !== 'request') return
	if (typeof data.id !== 'string') return

	forwardToBackground(data.id, data.payload)
})

// Jadikan file ini ES module agar deklarasi top-level tidak bocor ke global
// scope (mencegah "Cannot redeclare" ketika beberapa entry di-typecheck bersama).
export {}
