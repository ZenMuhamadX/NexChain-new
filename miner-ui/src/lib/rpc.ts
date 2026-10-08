import { rpcRequest } from 'src/client/rpc-client/lib/rpcRequest'
import { decodeHexJson } from 'src/client/rpc-client/lib/decodeHexJson'
import type { structBalance } from 'src/types/balance'

/**
 * Pembungkus RPC khusus miner.
 *
 * Hanya tiga metode yang dipakai:
 *   - `nex_getWork`          → job (payload + difficulty + expiry)
 *   - `nex_submitWork`       → kirim solusi, node verifikasi ulang & commit
 *   - `nex_getRecentBlocks`  → tip height / status koneksi
 * ditambah `nex_getChainId` (probe) dan `nex_getAccount` (saldo hadiah).
 *
 * Semuanya mengembalikan JSON polos KECUALI `nex_getAccount` yang
 * hex-JSON (lihat catatan heterogenitas di AGENTS.md), karena itu
 * `decodeHexJson` dipakai di sana.
 */

/** Respons mentah `nex_getWork` — longgar, divalidasi di pemanggil. */
export interface WorkResponse {
	status: boolean
	jobId?: string
	payload?: string
	difficulty?: number
	height?: number
	previousBlockHash?: string
	minerAddress?: string
	expiresAt?: number
	targetBlockTimeMs?: number
	error?: string
}

/** Job yang sudah tervalidasi lengkap — siap di-hash worker. */
export interface MiningJob {
	jobId: string
	payload: string
	difficulty: number
	height: number
	previousBlockHash: string
	expiresAt: number
}

export interface SubmitResponse {
	status: boolean
	height?: number
	hash?: string
	difficulty?: number
	minerAddress?: string
	error?: string
}

/** Ringkasan blok dari `nex_getRecentBlocks` (JSON polos). */
export interface BlockSummary {
	height: number
	hash: string
	previousBlockHash: string
	timestamp: number
	minerId: string
	txCount: number
	size: number
	status: string
	difficulty: number
	blockReward: number
	totalReward: number
}

export const getWork = (minerAddress: string): Promise<WorkResponse> =>
	rpcRequest('nex_getWork', { minerAddress })

export const submitWork = (
	jobId: string,
	nonce: number,
	hash: string,
): Promise<SubmitResponse> => rpcRequest('nex_submitWork', { jobId, nonce, hash })

export const getRecentBlocks = async (count = 1): Promise<BlockSummary[]> => {
	const raw = await rpcRequest('nex_getRecentBlocks', { count })
	return Array.isArray(raw) ? (raw as BlockSummary[]) : []
}

export const getChainId = async (): Promise<number | undefined> =>
	decodeHexJson<number>(await rpcRequest('nex_getChainId', ''))

export const getAccount = async (
	address: string,
): Promise<structBalance | undefined> =>
	decodeHexJson<structBalance>(await rpcRequest('nex_getAccount', address))

/**
 * Validasi alamat penerima hadiah memakai aturan KANONIK node
 * (`NxC`/`NxS` + 43 karakter) — bukan salinan, supaya UI dan node tidak
 * pernah berbeda pendapat soal alamat yang sah.
 */
export { isValidAddress as isValidMinerAddress } from 'src/core/transaction/utils/isValidAddress'
