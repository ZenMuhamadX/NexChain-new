import { Block } from 'src/core/block/blockModel'
import { rocksBlock } from 'src/core/state/db/block'
import { base58ToString } from 'src/core/encoding/hex/base58/base58ToString'
import { HexString } from 'src/types/block'

export const getBlockByHash = async (
	hash: string,
): Promise<Block | undefined> => {
	const block: HexString = (await rocksBlock.get(`blockHash:${hash}`, {
		fillCache: true,
	})) as HexString
	const decodedBlock = base58ToString(block)
	return JSON.parse(decodedBlock) as Block
}
