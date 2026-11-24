import { getNonce } from 'src/client/rpc-client/controller/rpcGetNonce'
import { rpcGetAccount } from 'src/client/rpc-client/controller/rpcGetAccount'
import { getRpcUrl } from 'src/client/rpc-client/lib/rpcClient'
import { rpcRequest } from 'src/client/rpc-client/lib/rpcRequest'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import type { structBalance } from 'src/types/balance'
import type { TxInterface } from 'src/types/transaction'

/** Contract default page size (max 100). The UI may use a smaller value. */
export const ACTIVITY_PAGE_SIZE = 25

export interface HistoryEntry extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

export interface ActivityPage {
	rows: { tx: HistoryEntry; pending: boolean }[]
	total: number
	page: number
	pageSize: number
	totalPages: number
}

export interface SendRawResult {
	status: boolean
	txHash?: string
	error?: string
}

let credentials: { user: string; password: string } | undefined

/** Clear user/password to use a loopback node without auth. */
export const setRpcCredentials = (user: string, password: string): void => {
	credentials = user && password ? { user, password } : undefined
}

const basicAuthHeader = (): string | undefined => {
	if (!credentials) return undefined
	const bytes = new TextEncoder().encode(
		`${credentials.user}:${credentials.password}`,
	)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return `Basic ${btoa(binary)}`
}

export const fetchAccount = (
	address: string,
): Promise<structBalance | undefined> => rpcGetAccount(address)

/** `nex_getBalance` returns a unit-bearing STRING, not a number. */
export const fetchBalanceString = (address: string): Promise<string> =>
	rpcRequest('nex_getBalance', address) as Promise<string>

/** `nex_getNextNonce` is the confirmed nonce plus the sender's pending txs. */
export const fetchNextNonce = (address: string): Promise<number> =>
	getNonce(address)

export const fetchPendingReserve = async (
	address: string,
): Promise<{ address: string; pendingAmount: number } | undefined> =>
	(await rpcRequest('nex_getPendingReserve', address)) ?? undefined

/**
 * One activity page: pending above confirmed, deduplicated by txHash.
 * The node already returns newest first, so the client does not re-sort.
 */
export const fetchActivityPage = async (
	address: string,
	page = 1,
	pageSize = ACTIVITY_PAGE_SIZE,
): Promise<ActivityPage> => {
	const [raw, pending] = await Promise.all([
		rpcRequest('nex_getTransactionsByAddress', {
			address,
			page,
			pageSize,
		}) as Promise<
			| {
					count?: number
					history?: HistoryEntry[]
					page?: number
					pageSize?: number
					totalPages?: number
			  }
			| undefined
		>,
		page === 1
			? (
					rpcRequest('nex_getPendingByAddress', address) as Promise<
						TxInterface[]
					>
				).catch((): TxInterface[] => [])
			: Promise.resolve([] as TxInterface[]),
	])

	const confirmed = raw?.history ?? []
	const seen = new Set(
		confirmed
			.map((entry) => entry.txHash)
			.filter((hash): hash is string => typeof hash === 'string'),
	)
	const fresh = pending.filter(
		(tx) => typeof tx.txHash !== 'string' || !seen.has(tx.txHash),
	)
	const total = typeof raw?.count === 'number' ? raw.count : confirmed.length
	const size = typeof raw?.pageSize === 'number' ? raw.pageSize : pageSize

	return {
		rows: [
			...fresh.map((tx) => ({ tx, pending: true })),
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

const writeRequest = async <T>(method: string, params: unknown): Promise<T> => {
	const headers: Record<string, string> = { 'content-type': 'application/json' }
	const authorization = basicAuthHeader()
	if (authorization) headers.authorization = authorization

	const response = await fetch(getRpcUrl(), {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		signal:
			typeof AbortSignal !== 'undefined' &&
			typeof AbortSignal.timeout === 'function'
				? AbortSignal.timeout(10_000)
				: null,
	})
	if (!response.ok) {
		throw new Error(
			response.status === 401 || response.status === 403
				? `The node rejected the request (HTTP ${response.status}). Check the RPC credentials.`
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

/** Send an already signed tx. Do not rebuild it here. */
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

/** Uji kredensial tanpa mengubah chain. */
export const authCheck = (): Promise<{ status: boolean }> =>
	writeRequest('nex_authCheck', '')
