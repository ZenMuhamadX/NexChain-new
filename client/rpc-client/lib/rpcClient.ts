import { JSONRPCClient } from 'json-rpc-2.0'

/** Endpoint default — konsisten dengan konvensi explorer (VITE_RPC_URL ?? localhost). */
const DEFAULT_RPC_URL = 'http://localhost:8000/rpc'

/** Hanya http(s) yang diizinkan (menolak javascript:, data:, file:, ...). */
const isHttpUrl = (value: string): boolean => {
	try {
		const url = new URL(value)
		return url.protocol === 'http:' || url.protocol === 'https:'
	} catch {
		return false
	}
}

/**
 * Baca override dari environment Node/Bun (`NEX_RPC_URL`).
 *
 * `process` dijaga dengan typeof supaya bundler browser tetap aman — pola yang
 * sama dipakai `logging/logging.ts` dan `logging/errorLog.ts`. Di browser
 * `process` tidak ada, jadi `typeof process === 'undefined'` dan kita jatuh ke
 * default (atau ke setRpcUrl() yang dipanggil UI wallet).
 */
const readEnvRpcUrl = (): string | undefined => {
	if (typeof process === 'undefined') return undefined
	const value = process.env?.NEX_RPC_URL
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

const initialRpcUrl = readEnvRpcUrl()
let rpcUrl =
	initialRpcUrl && isHttpUrl(initialRpcUrl) ? initialRpcUrl : DEFAULT_RPC_URL

/**
 * BUG-E4 (diperbaiki): URL sebelumnya di-hardcode `http://localhost:8000/rpc`.
 *
 * Wallet yang di-deploy akan mengirim request ke localhost MILIK PENGUNJUNG —
 * diam-diam gagal, atau menabrak service lokal yang tidak berhubungan, dan
 * testnet/mainnet mustahil disetel. Endpoint kini bisa diubah lewat:
 *   - env `NEX_RPC_URL` (Node/Bun/CLI), atau
 *   - `setRpcUrl()` saat runtime (dipakai UI wallet browser di Phase D).
 *
 * Nilainya dibaca SETIAP request (closure di `client`), jadi perubahan berlaku
 * untuk pemanggilan berikutnya tanpa membuat client baru.
 */
export const setRpcUrl = (url: string): void => {
	if (!isHttpUrl(url)) {
		throw new Error(`URL RPC tidak valid (harus http/https): ${url}`)
	}
	rpcUrl = url
}

/** Endpoint RPC yang sedang dipakai (untuk ditampilkan UI / debugging). */
export const getRpcUrl = (): string => rpcUrl

// JSONRPCClient needs to know how to send a JSON-RPC request.
// Tell it by passing a function to its constructor. The function must take a JSON-RPC request and send it.

/**
 * Batas tunggu per request RPC.
 *
 * Tanpa ini `fetch` bisa menggantung tanpa ujung (host tak terjangkau yang
 * paketnya DI-DROP, bukan di-refuse, menunggu TCP timeout puluhan detik) dan
 * alur unlock ikut tertahan. 10 dtk cukup untuk node lokal; lewat itu lebih
 * baik gagal cepat dan menampilkan banner daripada berputar tanpa kabar.
 */
const RPC_TIMEOUT_MS = 10_000

/** `AbortSignal.timeout` tidak ada di runtime lama → `null` (perilaku lama: tanpa timeout). */
const timeoutSignal = (): AbortSignal | null =>
	typeof AbortSignal !== 'undefined' &&
	typeof (AbortSignal as { timeout?: unknown }).timeout === 'function'
		? AbortSignal.timeout(RPC_TIMEOUT_MS)
		: null

export const client: JSONRPCClient = new JSONRPCClient(
	async (jsonRPCRequest) => {
		let response: Response
		try {
			response = await fetch(rpcUrl, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify(jsonRPCRequest),
				signal: timeoutSignal(),
			})
		} catch (error) {
			// Gagal jaringan ATAU timeout — keduanya diberi konteks endpoint supaya
			// banner UI bisa langsung menunjuk ke URL yang salah (bukan sekadar
			// "Load failed" yang tidak menyebut apa pun).
			const reason = error instanceof Error ? error.message : String(error)
			throw new Error(`${rpcUrl} tidak terjangkau: ${reason}`)
		}
		if (response.status === 200) {
			// Use client.receive when you received a JSON-RPC response.
			return response
				.json()
				.then((jsonRPCResponse) => client.receive(jsonRPCResponse))
		}
		console.error({
			status: response.status,
			statusText: response.statusText,
		})
		return Promise.reject(new Error('JSON-RPC error'))
	},
)
