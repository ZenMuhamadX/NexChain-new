/**
 * Tipe data explorer.
 *
 * Struct inti di-share langsung dari backend (`interface/*`) memakai
 * *type-only import* — tidak pernah ikut ke bundle, tapi tetap sinkron
 * dengan skema on-chain. Mirror lokal dipakai untuk tipe yang modul
 * backend-nya memuat dependensi runtime (LevelDB) yang tak relevan bagi UI.
 */
import type { structBalance } from 'src/types/balance'
import type { blockStruct, blockSummary, HexString } from 'src/types/block'
import type { TxInterface } from 'src/types/transaction'

export type { blockStruct, blockSummary, HexString, structBalance, TxInterface }

/** Serialisasi kelas backend `Block` → `{ block: ... }`. */
export interface BlockResponse {
	block: blockStruct
}

/**
 * Cerminan `blockState` dari nexchain/storage/state/setState.
 * (Tidak di-import langsung karena modulnya memuat koneksi LevelDB.)
 */
export interface BlockState {
	currentBlockHeight: number
	prevBlockHash: string
	currentBlockHash: string
	currentTimestamp: number
	blockReward: number
	lastUpdated: number
	currentBlockSize: number
}

export interface PendingReserve {
	address?: string
	pendingAmount?: number
}

/** Entry riwayat transaksi; `metadata` menyimpan asal blok bila tersedia. */
export interface HistoryEntry extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

/**
 * Respons `nex_getTransactionsByAddress`: objek JSON polos berisi
 * array `HistoryEntry` apa adanya.
 */
export interface TransactionHistory {
	count?: number
	history?: HistoryEntry[]
}

/* ---- payload JSON-RPC ---- */

export interface JsonRpcErrorPayload {
	code: number
	message: string
	data?: unknown
}

export interface JsonRpcResponse<T> {
	jsonrpc: '2.0'
	id: number
	result?: T
	error?: JsonRpcErrorPayload
}
