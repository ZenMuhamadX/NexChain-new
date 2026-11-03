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

/**
 * Status sinkronisasi node (`nex_getSyncStatus`). `syncing: true` berarti node
 * masih mengejar rantai peer, jadi angka saldo bisa tertinggal dari jaringan.
 */
export const fetchSyncStatus = async (): Promise<
	{ syncing?: boolean } | undefined
> => (await rpcRequest('nex_getSyncStatus', '')) as { syncing?: boolean } | undefined

/**
 * Tx pending milik SATU alamat (`nex_getPendingByAddress` — indeks
 * `mpf:<from>:`, ≤16 entri di node).
 *
 * Sengaja TIDAK memakai `nex_getMempool`: method itu memotong pool ke 100
 * entri GLOBAL, jadi saat mempool ramai tx pending pengguna bisa hilang dari
 * Riwayat walau dananya masih terkunci. Mengunduh seluruh pool juga berat di
 * HP untuk data yang sebagian besar tidak relevan.
 *
 * Batas yang diterima: tx MASUK yang masih pending belum tampil (indeks node
 * hanya per-pengirim); ia muncul setelah masuk blok.
 */
export const fetchPendingByAddress = async (
	address: string,
): Promise<TxInterface[]> => {
	const raw = await rpcRequest('nex_getPendingByAddress', address)
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
	/** true = masih di mempool (belum ada di `addr:` index). */
	pending: boolean
}

/** Ukuran halaman riwayat — sama dengan `HISTORY_PAGE_SIZE` di node. */
/** Ukuran satu halaman daftar aktivitas Beranda. */
export const ACTIVITY_PAGE_SIZE = 10

/** Respons `nex_getTransactionsByAddress` bentuk berpaginasi. */
interface HistoryPageResponse {
	/** TOTAL entri alamat ini, bukan panjang `history`. */
	count?: number
	history?: HistoryEntry[]
	page?: number
	pageSize?: number
	totalPages?: number
}

export interface ActivityPage {
	rows: HistoryRow[]
	total: number
	page: number
	pageSize: number
	totalPages: number
}

/**
 * Satu halaman riwayat: tx terkonfirmasi halaman itu + tx pending milik
 * alamat ini (hanya di halaman pertama).
 *
 * MENGAPA berpaginasi: tanpa `pageSize`, `nex_getTransactionsByAddress`
 * mengembalikan SELURUH riwayat alamat — satu respons berisi ribuan transaksi
 * yang harus di-decode node satu per satu, tiap kali layar dibuka. Dengan
 * `{ address, page, pageSize }` node hanya men-decode 25 baris; `count` (total)
 * tetap dikirim supaya nomor halaman bisa ditampilkan.
 *
 * MENGAPA pending hanya di halaman 1: ia duduk DI ATAS daftar, bukan bagian
 * dari jendela berpaginasi. Kalau ikut di setiap halaman, "halaman 1 dari 47"
 * tidak lagi cocok dengan jumlah baris yang terlihat.
 *
 * Sengaja TIDAK ada pengurutan ulang di klien. Urutan server (tinggi blok
 * menurun) sudah "terbaru dulu"; mengurutkan ulang di sini akan membuat baris
 * di batas halaman muncul dua kali atau hilang. Pending selalu paling baru,
 * jadi ia memang layak di paling atas.
 */
export const fetchActivityPage = async (
	address: string,
	page = 1,
	pageSize = ACTIVITY_PAGE_SIZE,
): Promise<ActivityPage> => {
	const [raw, mempool] = await Promise.all([
		rpcRequest('nex_getTransactionsByAddress', {
			address,
			page,
			pageSize,
		}) as Promise<HistoryPageResponse | undefined>,
		page === 1
			? fetchPendingByAddress(address).catch((): TxInterface[] => [])
			: Promise.resolve([] as TxInterface[]),
	])

	const confirmed: HistoryEntry[] = []
	for (const item of raw?.history ?? []) {
		if (item) confirmed.push(item)
	}

	const seen = new Set<string>()
	for (const entry of confirmed) {
		if (typeof entry.txHash === 'string') seen.add(entry.txHash)
	}

	const pending = mempool.filter(
		(tx) => typeof tx.txHash !== 'string' || !seen.has(tx.txHash),
	)

	const total = typeof raw?.count === 'number' ? raw.count : confirmed.length
	const size = typeof raw?.pageSize === 'number' ? raw.pageSize : pageSize

	return {
		rows: [
			...pending.map((tx) => ({ tx, pending: true })),
			...confirmed.map((tx) => ({ tx, pending: false })),
		],
		total,
		page: typeof raw?.page === 'number' ? raw.page : page,
		pageSize: size,
		totalPages:
			typeof raw?.totalPages === 'number'
				? raw.totalPages
				: Math.ceil(total / size),
	}
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
