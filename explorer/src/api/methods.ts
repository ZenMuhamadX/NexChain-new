import { RPC_URL } from '../config/env'
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
 * Semua hasil RPC kini JSON polos — tanpa envelope hex.
 * Field biner tertentu (sign, extraData) tetap hex DI DALAM payload
 * dan di-decode di tempat render (tryHexText), bukan di sini.
 */
export const rpc = {
	getChainId: () => client.request<number>('nex_getChainId'),

	// Data wajib: tanpa guard ini, state yang hilang bikin UI diam-diam
	// kosong, bukan error yang terlihat (dulu `hexJsonOrThrow` melempar).
	getBlockState: async (): Promise<BlockState> => {
		const state = await client.request<BlockState | null | undefined>(
			'nex_getBlockState',
		)
		if (state === undefined || state === null) {
			throw new RpcClientError(
				'invalid-response',
				'nex_getBlockState returned no data.',
			)
		}
		return state
	},

	getCurrentBlock: () => client.request<BlockResponse>('nex_getCurrentBlock'),

	getBlockByHeight: (height: number) =>
		client.request<BlockResponse>('nex_getBlockByHeight', height),

	getBlockByHash: (hash: string) =>
		client.request<BlockResponse>('nex_getBlockByHash', hash),

	getAccount: (address: string) =>
		client.request<structBalance>('nex_getAccount', address),

	getNonce: (address: string) =>
		client.request<number>('nex_getNonceAccount', address),

	// Nonce transaksi BERIKUTNYA (account nonce + tx masih pending di mempool).
	getNextNonce: (address: string) =>
		client.request<number>('nex_getNextNonce', address),

	getPendingReserve: (address: string) =>
		client.request<{ address: string; pendingAmount: number }>(
			'nex_getPendingReserve',
			address,
		),

	getTransactionCount: (address: string) =>
		client.request<number>('nex_getTransactionCount', address),

	getTransactionByHash: (hash: string) =>
		client.request<HistoryEntry>('nex_getTransactionByTxHash', hash),

	getBalanceText: (address: string) =>
		client.request<string>('nex_getBalance', address),

	getRecentBlocks: (count?: number) =>
		client.request<blockSummary[]>('nex_getRecentBlocks', count),

	getBlocksRange: (from: number, count?: number) =>
		client.request<blockSummary[]>('nex_getBlocksRange', { from, count }),

	getMempool: () => client.request<TxInterface[]>('nex_getMempool'),

	getTransactionsByAddress: async (
		address: string,
	): Promise<{ count: number; history: HistoryEntry[] }> => {
		const raw = await client.request<TransactionHistory>(
			'nex_getTransactionsByAddress',
			address,
		)
		const history = raw?.history ?? []
		return { count: raw?.count ?? history.length, history }
	},
}
