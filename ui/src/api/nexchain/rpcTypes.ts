export interface Header { previousBlockHash: string; timestamp: number; hash: string; nonce: number; version: string; difficulty: number; hashingAlgorithm: string }
export interface Transaction { format: 'nexu'; sender: string; receiver: string; amount: number; timestamp: number; txHash?: string; extraMessage: string; fee: number; status: 'pending' | 'confirmed' | 'rejected'; isValid: boolean; isPending: boolean; hexInput?: `0x${string}`; isSenderContract: boolean; isReceiverContract: boolean; sign: { v: number; r: string; s: string } }
export interface BlockData { header: Header; height: number; size: number; totalTransactionFees: number; merkleRoot: string; minerId: string; chainId?: number; status: 'confirmed' | 'pending'; blockReward: number; totalReward: number; sign: { v: number; r: string; s: string }; coinbaseTransaction: { receiver: string; amount: number; extraData?: `0x${string}` }; metadata?: { txCount: number; gasPrice: number; created_at: number; extraData: `0x${string}` }; transactions: Transaction[]; contract?: { contractAddress: string; owner: string; balance: number; contractCodeHash?: string; deploymentTransactionHash: string; deployedAt: number; status: 'active' | 'inactive'; currency: 'nexu' }[] }
export interface Block { block: BlockData }
export interface Account { address: string; balance: number; transactionCount: number; lastTransactionDate: number | null; nonce: number; isContract: boolean }
export interface PendingBalance { address: string; pendingAmount: number }
export interface TransactionHistory { count: number; history: Transaction[] }
export type BlockState = Record<string, unknown>
export interface JsonRpcErrorPayload { code: number; message: string; data?: unknown }
export interface JsonRpcResponse<T> { jsonrpc: '2.0'; id: number; result?: T; error?: JsonRpcErrorPayload }
