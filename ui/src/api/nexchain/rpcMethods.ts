import { nexchainRpcUrl } from '../../config/env'
import { decodeHexJson, decodeHexString } from './rpcDecoder'
import { NexchainRpcClient } from './rpcClient'
import type { Account, Block, BlockState, PendingBalance, Transaction, TransactionHistory } from './rpcTypes'

const client = new NexchainRpcClient(nexchainRpcUrl)
const numberResult = (value: unknown): number => { const result = decodeHexJson<unknown>(value); if (typeof result !== 'number') throw new Error('NexChain RPC returned a non-numeric count.'); return result }
export const nexchainRpc = {
  getCurrentBlock: async () => decodeHexJson<Block>(await client.request('nex_getCurrentBlock')),
  getBlockByHeight: async (height: number) => decodeHexJson<Block>(await client.request('nex_getBlockByHeight', height)), getBlockByHash: async (hash: string) => decodeHexJson<Block>(await client.request('nex_getBlockByHash', hash)),
  getBlockTransactionCountByHeight: (height: number) => client.request<number>('nex_getBlockTransactionByHeight', height), getBlockTransactionCountByHash: (hash: string) => client.request<number>('nex_getBlockTransactionByHash', hash), getBlockState: async () => decodeHexJson<BlockState>(await client.request('nex_getBlockState')), getChainId: () => client.request<number>('nex_getChainId'),
  getPendingBalance: async (address: string) => decodeHexJson<PendingBalance>(await client.request('nex_getPendingBalance', address)), getAccount: async (address: string) => decodeHexJson<Account | undefined>(await client.request('nex_getAccount', address)), getBalance: async (address: string) => decodeHexString(await client.request('nex_getBalance', address)), getNonceAccount: async (address: string) => numberResult(await client.request('nex_getNonceAccount', address)), getTransactionCount: async (address: string) => numberResult(await client.request('nex_getTransactionCount', address)), getTransactionByHash: async (hash: string) => decodeHexJson<Transaction | undefined>(await client.request('nex_getTransactionByTxHash', hash)), getTransactionsByAddress: async (address: string) => decodeHexJson<TransactionHistory>(await client.request('nex_getTransactionsByAddress', address)),
}
