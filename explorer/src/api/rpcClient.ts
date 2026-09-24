import type { JsonRpcErrorPayload, JsonRpcResponse } from './types'

export type RpcErrorKind =
	| 'network'
	| 'timeout'
	| 'http'
	| 'rate-limited'
	| 'malformed-json'
	| 'json-rpc'
	| 'invalid-response'
	| 'decode'

export class RpcClientError extends Error {
	constructor(
		public readonly kind: RpcErrorKind,
		message: string,
		public readonly details?: JsonRpcErrorPayload | number,
	) {
		super(message)
		this.name = 'RpcClientError'
	}
}

/**
 * Error "tidak ditemukan" dari backend — bukan bug server.
 *
 * Probe end-to-end menunjukkan backend (Bun + Level) TIDAK selalu
 * melempar pesan "Key not found"; ada tiga signature nyata untuk data
 * yang hilang:
 * - "Key not found…" / "not found" — miss LevelDB klasik.
 * - "Expected String"              — block-by-hash miss: `get` balik
 *   `undefined` lalu `base58ToString(undefined)` melempar error ini.
 * - "…buffer.toString…"            — tx-by-hash miss:
 *   decode dipanggil di atas `undefined` (varian Node:
 *   "Cannot read properties of undefined (reading 'toString')").
 *
 * Input lookup sudah divalidasi format di client (64-hex / pola alamat),
 * jadi error JSON-RPC dengan signature ini dari method lookup = miss.
 */
const MISS_SIGNATURES =
	/not found|does not exist|key not found|expected string|buffer\.toString|cannot read properties of undefined \(reading 'toString'\)/i

export function isNotFound(error: unknown): boolean {
	// Duck-typed (bukan instanceof): cukup bentuk `{kind, message}`.
	// Selain cocok dengan kontraknya, ini kebal terhadap duplikasi identitas
	// kelas (mis. modul ter-load dua specifier / edge HMR) yang membuat
	// instanceof gagal meski error-nya benar-benar RpcClientError.
	if (typeof error !== 'object' || error === null) return false
	const candidate = error as { kind?: unknown; message?: unknown }
	if (candidate.kind !== 'json-rpc') return false
	if (typeof candidate.message !== 'string') return false
	return MISS_SIGNATURES.test(candidate.message)
}

/**
 * Client JSON-RPC 2.0 tipis khusus NexChain RPC (POST /rpc).
 *
 * Catatan perilaku backend: ketika method tidak punya nilai (mis.
 * blok dengan height tak dikenal), response datang TANPA key `result`
 * ATAU dengan `result: null` (terverifikasi lewat probe) — kedua
 * kondisi diterjemahkan ke `undefined` (bukan error), agar halaman
 * bisa menampilkan state "tidak ditemukan" dengan anggun.
 */
export class NexchainRpcClient {
	private nextId = 1

	constructor(
		private readonly endpoint: string,
		private readonly timeoutMs = 10_000,
	) {}

	async request<T>(
		method: string,
		params?: unknown,
		signal?: AbortSignal,
	): Promise<T> {
		const id = this.nextId++
		const timeout = AbortSignal.timeout(this.timeoutMs)
		const abort = signal ? AbortSignal.any([signal, timeout]) : timeout

		let response: Response
		try {
			response = await fetch(this.endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					method,
					// Backend meneruskan `params` apa adanya sebagai argumen tunggal,
					// jadi scalar (height/address) maupun object diterima.
					...(params === undefined ? {} : { params }),
					id,
				}),
				signal: abort,
			})
		} catch (error) {
			if (timeout.aborted) {
				throw new RpcClientError(
					'timeout',
					`NexChain RPC tidak merespons dalam ${this.timeoutMs / 1000} detik.`,
				)
			}
			if (error instanceof DOMException && error.name === 'AbortError') {
				throw new RpcClientError('network', 'Permintaan dibatalkan.')
			}
			throw new RpcClientError(
				'network',
				'Tidak bisa terhubung ke NexChain RPC. Pastikan server berjalan: bun run rpc:start',
			)
		}

		if (response.status === 429) {
			throw new RpcClientError(
				'rate-limited',
				'Terlalu banyak permintaan (rate limit). Coba lagi sebentar lagi.',
				429,
			)
		}
		if (!response.ok) {
			throw new RpcClientError(
				'http',
				`NexChain RPC mengembalikan HTTP ${response.status}.`,
				response.status,
			)
		}

		let payload: JsonRpcResponse<T>
		try {
			payload = (await response.json()) as JsonRpcResponse<T>
		} catch {
			throw new RpcClientError(
				'malformed-json',
				'NexChain RPC mengembalikan JSON tidak valid.',
			)
		}

		if (!payload || payload.jsonrpc !== '2.0' || payload.id !== id) {
			throw new RpcClientError(
				'invalid-response',
				'NexChain RPC mengembalikan respons JSON-RPC tidak valid.',
			)
		}
		if (payload.error) {
			throw new RpcClientError(
				'json-rpc',
				payload.error.message || `JSON-RPC error ${payload.error.code}.`,
				payload.error,
			)
		}
		// Tanpa key `result` ATAU `result: null` = method backend tidak
		// punya nilai → terjemahkan ke undefined (state "tidak ditemukan").
		if (!Object.hasOwn(payload, 'result') || payload.result === null) {
			return undefined as T
		}
		return payload.result as T
	}
}
