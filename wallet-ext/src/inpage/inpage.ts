/**
 * Inpage Provider (dijalankan di dunia halaman).
 *
 * Menempelkan `window.nexchain` sebagai provider ala EIP-1193 supaya dApp bisa
 * meminta koneksi/penandatanganan tanpa mengetahui detail extension.
 *
 * ALUR:
 *   dApp: window.nexchain.request({ method, params })
 *     → postMessage ke content script (channel 'nexchain-provider')
 *     → content script meneruskan ke service worker
 *     → balasan dikembalikan lewat postMessage yang sama
 *
 * CATATAN: file ini TIDAK boleh menyimpan private key atau melakukan kripto —
 * hanya jembatan. Segala operasi rahasia terjadi di konteks extension.
 */

const CHANNEL = 'nexchain-provider'

interface ProviderRequest {
	method: string
	params?: unknown[] | Record<string, unknown>
}

type PendingResolver = {
	resolve: (value: unknown) => void
	reject: (reason: Error) => void
}

const pending = new Map<string, PendingResolver>()

const newId = (): string =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `nex-${Date.now()}-${Math.random().toString(16).slice(2)}`

/** Kirim request ke content script dan tunggu balasan. */
const send = (payload: ProviderRequest): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const id = newId()
		pending.set(id, { resolve, reject })

		window.postMessage(
			{ channel: CHANNEL, kind: 'request', id, payload },
			window.location.origin,
		)

		// Timeout agar dApp tidak menggantung bila extension tidak merespons.
		window.setTimeout(() => {
			if (pending.has(id)) {
				pending.delete(id)
				reject(new Error('NexChain provider: request timeout'))
			}
		}, 30_000)
	})

window.addEventListener('message', (event: MessageEvent) => {
	if (event.source !== window) return
	const data = event.data as
		| { channel?: string; kind?: string; id?: string; response?: unknown }
		| undefined
	if (!data || data.channel !== CHANNEL || data.kind !== 'response') return
	if (typeof data.id !== 'string') return

	const entry = pending.get(data.id)
	if (!entry) return
	pending.delete(data.id)

	const response = data.response as { ok?: boolean; error?: string } | undefined
	if (response && response.ok === false) {
		entry.reject(new Error(response.error ?? 'Request ditolak'))
	} else {
		entry.resolve(response)
	}
})

interface NexChainProvider {
	isNexChain: true
	request: (args: ProviderRequest) => Promise<unknown>
}

const provider: NexChainProvider = {
	isNexChain: true,
	request: (args: ProviderRequest): Promise<unknown> => send(args),
}

;(window as unknown as { nexchain?: NexChainProvider }).nexchain = provider

// Jadikan file ini ES module — lihat catatan di content.ts.
export {}
