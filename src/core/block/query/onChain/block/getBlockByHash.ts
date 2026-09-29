import { HexString } from 'src/types/block'
import { Block } from 'src/core/block/blockModel'
import { rocksBlock } from 'src/core/state/db/block'
import { base58ToString } from 'src/core/encoding/hex/base58/base58ToString'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'

export const getBlockByHash = async (
	hash: string,
	enc: 'hex' | 'json',
): Promise<Block | HexString> => {
	const block: HexString = (await rocksBlock.get(`blockHash:${hash}`, {
		fillCache: true,
	})) as HexString
	const decodedBlock = base58ToString(block)
	if (enc === 'json') {
		return JSON.parse(decodedBlock) as Block
	}
	return stringToHex(decodedBlock)
}
