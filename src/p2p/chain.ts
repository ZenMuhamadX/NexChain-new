/**
 * Adaptor baca-rantai untuk lapisan P2P.
 *
 * Menyembunyikan detail `src/core/` (bentuk state, pengecualian "belum ada")
 * di balik fungsi kecil yang TIDAK PERNAH melempar untuk kasus normal —
 * "belum ada" berarti `undefined`/`false`, bukan exception. Transport & sync
 * jadi tidak perlu tahu bahwa `getBlockByHash` melempar bila key absen.
 *
 * Modul ini hanya BACA. Semua penulisan tetap lewat `connectBlock` →
 * `chains.commitBlock` (satu-satunya jalur commit).
 */
import { Block } from 'src/core/block/blockModel'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { getBlockByHash } from 'src/core/block/query/onChain/block/getBlockByHash'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { GENESIS_HASH } from 'src/core/block/genesis'
import { CHAIN_ID } from 'src/crypto/chainId'
import type { LocalChainStatus } from './types'

/**
 * Status rantai lokal untuk handshake `version`.
 *
 * Bila `blockState` belum ada (node baru sebelum genesis terbentuk), jatuh ke
 * posisi genesis konstanta — bukan melempar. Node yang belum punya state
 * sebenarnya tidak boleh ikut P2P, tetapi nilai fallback yang aman lebih baik
 * daripada crash di jalur handshake.
 */
export const getLocalChainStatus = async (
	listenPort?: number,
): Promise<LocalChainStatus> => {
	let bestHeight = 0
	let bestHash = GENESIS_HASH
	try {
		const state = await getBlockState()
		if (state) {
			bestHeight = state.currentBlockHeight
			bestHash = state.currentBlockHash
		}
	} catch {
		// DB belum siap — pakai fallback genesis.
	}
	const status: LocalChainStatus = {
		chainId: CHAIN_ID,
		genesisHash: GENESIS_HASH,
		bestHeight,
		bestHash,
	}
	if (listenPort !== undefined) status.listenPort = listenPort
	return status
}

/** Blok berdasarkan hash, atau `undefined` bila tidak ada / tidak terbaca. */
export const tryGetBlockByHash = async (
	hash: string,
): Promise<Block | undefined> => {
	if (typeof hash !== 'string' || hash.length === 0) return undefined
	try {
		const block = (await getBlockByHash(hash, 'json')) as Block
		return block ?? undefined
	} catch {
		return undefined
	}
}

/** Blok berdasarkan height, atau `undefined` bila tidak ada / tidak terbaca. */
export const tryGetBlockByHeight = async (
	height: number,
): Promise<Block | undefined> => {
	if (!Number.isSafeInteger(height) || height < 0) return undefined
	try {
		const block = (await getBlockByHeight(height, 'json')) as Block | undefined
		return block ?? undefined
	} catch {
		return undefined
	}
}

/** Apakah kita sudah punya blok dengan hash ini. */
export const hasBlock = async (hash: string): Promise<boolean> => {
	const block = await tryGetBlockByHash(hash)
	return block !== undefined
}

/** Hash blok pada height tertentu, atau `undefined` bila belum ada. */
export const getBlockHashByHeight = async (
	height: number,
): Promise<string | undefined> => {
	const block = await tryGetBlockByHeight(height)
	return block?.block.header.hash
}
