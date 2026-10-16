import { RPC_URL } from '../config/env'
import { decodeHexJson, decodeHexString } from './decoder'
import { NexchainRpcClient, RpcClientError } from './rpcClient'
import type {
	BlockResponse,
	BlockState,
	HistoryEntry,
	TransactionHistory,
	TxInterface,
	blockSummary,
	structBalance,
} from './types'

const client = new NexchainRpcClient(RPC_URL)

/**
 * Tabel decode per-method — encoding backend memang tidak seragam:
 * - hex JSON  : getCurrentBlock, getBlockBy*, getBlockState, getAccount,
 *               getNonce, getNextNonce, getPendingReserve, getTransactionCount,
 *               getTransactionByTxHash
 * - hex string : getBalance
 * - number    : getChainId, getBlockTransactionByHeight
 * - objek     : getTransactionsByAddress (item history di dalamnya hex)
 * - JSON polos: method baru untuk explorer (getRecentBlocks, getBlocksRange,
 *               getMempool)
 */
const hexJson = async <T>(
	method: string,
	params?: unknown,
): Promise<T | undefined> => {
	const raw = await client.request<unknown>(method, params)
	if (raw === undefined || raw === null) return undefined
	return decodeHexJson<T>(raw)
}

/** Versi yang wajib ada — untuk data wajib seperti block state. */
const hexJsonOrThrow = async <T>(
	method: string,
	params?: unknown,
): Promise<T> => {
	const value = await hexJson<T>(method, params)
	if (value === undefined) {
		throw new RpcClientError('invalid-response', `${method} returned no data.`)
	}
	return value
}

export const rpc = {
	getChainId: () => client.request<number>('nex_getChainId'),

	getBlockState: () => hexJsonOrThrow<BlockState>('nex_getBlockState'),

	getCurrentBlock: () => hexJson<BlockResponse>('nex_getCurrentBlock'),

	getBlockByHeight: (height: number) =>
		hexJson<BlockResponse>('nex_getBlockByHeight', height),

	getBlockByHash: (hash: string) =>
		hexJson<BlockResponse>('nex_getBlockByHash', hash),

	getAccount: (address: string) =>
		hexJson<structBalance>('nex_getAccount', address),

	getNonce: (address: string) =>
		hexJson<number>('nex_getNonceAccount', address),

	// Nonce transaksi BERIKUTNYA (account nonce + tx masih pending di mempool).
	getNextNonce: (address: string) =>
		hexJson<number>('nex_getNextNonce', address),

	getPendingReserve: (address: string) =>
		hexJson<{ address: string; pendingAmount: number }>(
			'nex_getPendingReserve',
			address,
		),

	getTransactionCount: (address: string) =>
		hexJson<number>('nex_getTransactionCount', address),

	getTransactionByHash: (hash: string) =>
		hexJson<HistoryEntry>('nex_getTransactionByTxHash', hash),

	getBalanceText: (address: string) =>
		client.request<string>('nex_getBalance', address).then(decodeHexString),

	/* ---- JSON polos (method baru untuk explorer) ---- */

	getRecentBlocks: (count?: number) =>
		client.request<blockSummary[]>('nex_getRecentBlocks', count),

	getBlocksRange: (from: number, count?: number) =>
		client.request<blockSummary[]>('nex_getBlocksRange', { from, count }),

	getMempool: () => client.request<TxInterface[]>('nex_getMempool'),

	/* ---- objek JSON polos; tiap item history hex → decode per item ---- */

	getTransactionsByAddress: async (
		address: string,
	): Promise<{ count: number; history: HistoryEntry[] }> => {
		const raw = await client.request<TransactionHistory>(
			'nex_getTransactionsByAddress',
			address,
		)
		const items = raw?.history ?? []
		const history = items.map((item) =>
			typeof item === 'string' ? decodeHexJson<HistoryEntry>(item) : item,
		)
		return { count: raw?.count ?? history.length, history }
	},
}
