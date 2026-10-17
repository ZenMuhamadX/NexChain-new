import { rpcRequest } from 'src/client/rpc-client/lib/rpcRequest'
import { rpcGetAccount } from 'src/client/rpc-client/controller/rpcGetAccount'
import { rpcGetPendingReserve } from 'src/client/rpc-client/controller/rpcGetPendingReserve'
import { getNonce } from 'src/client/rpc-client/controller/rpcGetNonce'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { getRpcUrl, getRpcCredentials } from './rpcUrl'
import type { TxInterface } from 'src/types/transaction'
import type { structBalance } from 'src/types/balance'
import type { pendingReserve } from 'src/core/transaction/getPendingReserve'

/**
 * Pembungkus RPC untuk UI wallet.
 *
 * Semua hasil RPC kini JSON polos.
 * `nex_getMempool` / `nex_sendRawTransaction` mengembalikan JSON polos.
 *
 * Param tanpa-argumen memakai `''` karena `client.request` json-rpc-2.0
 * butuh dua argumen dan meneruskan params verbatim sebagai argumen tunggal.
 *
 * Pengecualian: `nex_sendRawTransaction` (method TULIS) tidak lewat
 * `rpcRequest` bersama, tapi lewat `writeRequest` lokal di bawah — satu-satunya
 * jalan menyelipkan header `Authorization: Basic …` dari layar Settings
 * (lihat `lib/rpcUrl.ts` → `getRpcCredentials`).
 */

export const fetchAccount = (
	address: string,
): Promise<structBalance | undefined> => rpcGetAccount(address)

export const fetchPending = (
	address: string,
): Promise<pendingReserve | undefined> => rpcGetPendingReserve(address)

/** Nonce yang dibutuhkan transaksi berikutnya (`nex_getNextNonce`). */
export const fetchNextNonce = (address: string): Promise<number> =>
	getNonce(address)

export const fetchChainId = async (): Promise<number | undefined> =>
	(await rpcRequest('nex_getChainId', '')) as number | undefined

export const fetchMempool = async (): Promise<TxInterface[]> => {
	const raw = await rpcRequest('nex_getMempool', '')
	return Array.isArray(raw) ? (raw as TxInterface[]) : []
}

/**
 * Entry riwayat; `metadata` menyimpan asal blok bila tersedia
 * (cerminan `HistoryEntry` explorer — lokal agar tidak menarik runtime
 * explorer ke bundle).
 */
export interface HistoryEntry extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

export interface HistoryRow {
	tx: HistoryEntry
	/** true = masih di mempool (belum ada di `address:` index). */
	pending: boolean
}

/**
 * Riwayat gabungan: transaksi terkonfirmasi + mempool.
 *
 * `nex_getTransactionsByAddress` hanya membaca index `address:{addr}` yang
 * ditulis `saveTxByAddress` saat PROSES MINING — transaksi yang masih di
 * mempool TIDAK muncul di sana (saveTxHistory menulis kunci per-hash saja).
 * Tanpa penggabungan ini tab Riwayat wallet selalu kosong tepat setelah user
 * mengirim. Mempool difilter ke address yang relevan dan didedup per txHash
 * (konfirmasi menang bila sudah ada di keduanya).
 */
export const fetchHistory = async (address: string): Promise<HistoryRow[]> => {
	const raw = (await rpcRequest('nex_getTransactionsByAddress', address)) as
		{ count?: number; history?: HistoryEntry[] } | undefined

	const confirmed: HistoryEntry[] = []
	for (const item of raw?.history ?? []) {
		const entry = item
		if (entry) confirmed.push(entry)
	}

	const seen = new Set<string>()
	for (const entry of confirmed) {
		if (typeof entry.txHash === 'string') seen.add(entry.txHash)
	}

	const mempool = await fetchMempool()
	const pending = mempool
		.filter((tx) => tx.from === address || tx.receiver === address)
		.filter((tx) => typeof tx.txHash !== 'string' || !seen.has(tx.txHash))

	const rows: HistoryRow[] = [
		...confirmed.map((tx) => ({ tx, pending: false })),
		...pending.map((tx) => ({ tx, pending: true })),
	]
	// Urutkan menurut waktu BLOK. Transaksi masih tertunda belum punya blok,
	// jadi ia diletakkan paling atas (paling baru).
	const timeOf = (row: HistoryRow): number =>
		row.pending
			? Number.MAX_SAFE_INTEGER
			: (row.tx.metadata?.blockTimestamp ?? 0)
	rows.sort((a, b) => timeOf(b) - timeOf(a))
	return rows
}

export interface SendRawResult {
	status: boolean
	txHash?: string
	error?: string
}

/**
 * Header `Authorization: Basic …` dari kredensial Settings — `undefined`
 * bila belum lengkap, sehingga dev lokal TANPA auth tetap mengirim request
 * persis seperti biasanya (tanpa header).
 *
 * `btoa` hanya menerima Latin-1, jadi string-nya dulu di-encode UTF-8
 * (password non-ASCII tidak membuatnya melempar).
 */
const basicAuthHeader = (): string | undefined => {
	const { user, password } = getRpcCredentials()
	if (!user || !password) return undefined
	const bytes = new TextEncoder().encode(`${user}:${password}`)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return `Basic ${btoa(binary)}`
}

/** Batas tunggu — sama dengan `src/client/rpc-client/lib/rpcClient.ts`. */
const RPC_TIMEOUT_MS = 10_000

const timeoutSignal = (): AbortSignal | null =>
	typeof AbortSignal !== 'undefined' &&
	typeof (AbortSignal as { timeout?: unknown }).timeout === 'function'
		? AbortSignal.timeout(RPC_TIMEOUT_MS)
		: null

let writeRequestId = 0

/**
 * Request JSON-RPC untuk METHOD TULIS, lengkap dengan header Basic Auth.
 *
 * Client bersama (`src/client/rpc-client/lib/rpcClient.ts`) tidak punya
 * titik sisipan header, dan hanya method tulis yang butuh autentikasi —
 * jadi jalur fetch-nya ditulis sendiri di sini dengan perilaku yang sama
 * (URL aktif dari `getRpcUrl`, timeout, error non-200 / `error` JSON-RPC
 * → throw supaya `sendForm` memetakannya ke pesan UI).
 */
const writeRequest = async <T>(method: string, params: unknown): Promise<T> => {
	const headers: Record<string, string> = { 'content-type': 'application/json' }
	const authorization = basicAuthHeader()
	if (authorization) headers.authorization = authorization

	const response = await fetch(getRpcUrl(), {
		method: 'POST',
		headers,
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++writeRequestId,
			method,
			params,
		}),
		signal: timeoutSignal(),
	})
	if (!response.ok) {
		throw new Error(
			response.status === 401 || response.status === 403
				? `Node menolak transaksi (HTTP ${response.status}) — periksa RPC Username/Password di Settings.`
				: `HTTP ${response.status} ${response.statusText}`,
		)
	}
	const body = (await response.json()) as {
		result?: T
		error?: { code?: number; message?: string }
	}
	if (body.error) {
		throw new Error(body.error.message ?? `JSON-RPC error ${body.error.code}`)
	}
	return body.result as T
}

/** Kirim transaksi sudah tertandatangan (`nex_sendRawTransaction`, JSON polos). */
export const sendRawTransaction = async (
	signed: TxInterface,
): Promise<SendRawResult> => {
	const response = await writeRequest<SendRawResult>(
		'nex_sendRawTransaction',
		encodeTx(signed),
	)

	const result: SendRawResult = { status: response?.status === true }
	if (typeof response?.txHash === 'string') result.txHash = response.txHash
	if (typeof response?.error === 'string') result.error = response.error
	return result
}
