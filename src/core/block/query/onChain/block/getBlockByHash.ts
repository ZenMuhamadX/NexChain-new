import { Block } from 'src/core/block/blockModel'
import { rocksBlock } from 'src/core/state/db/block'
import { base58ToString } from 'src/core/encoding/hex/base58/base58ToString'
import { HexString } from 'src/types/block'

export const getBlockByHash = async (
	hash: string,
): Promise<Block | undefined> => {
	const stored = (await rocksBlock.get(`blockHash:${hash}`, {
		fillCache: true,
	})) as HexString | undefined
	if (!stored) return undefined
	// `j:` = badan blok JSON padat (format baru). Tanpa awalan = blok lama
	// ber-base58 — tetap terbaca supaya data dir lama tidak perlu di-rebuild.
	const decodedBlock = stored.startsWith('j:')
		? stored.slice(2)
		: base58ToString(stored)
	return JSON.parse(decodedBlock) as Block
}
