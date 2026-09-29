import { Block } from 'src/core/block/blockModel'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { HexString } from 'src/types/block'
import { getBlockByHash } from './getBlockByHash'

export const getCurrentBlock = async (
	enc: 'json' | 'hex',
): Promise<Block | HexString> => {
	const stateData = await getBlockState()
	if (!stateData) {
		throw new Error('Block state not found')
	}
	const latestBlock = await getBlockByHash(stateData?.currentBlockHash, enc)
	if (!latestBlock) {
		throw new Error('Block not found')
	}
	return latestBlock
}
