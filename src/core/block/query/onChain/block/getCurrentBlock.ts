import { Block } from 'src/core/block/blockModel'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { getBlockByHash } from './getBlockByHash'

export const getCurrentBlock = async (): Promise<Block | undefined> => {
	const stateData = await getBlockState()
	if (!stateData) {
		throw new Error('Block state not found')
	}
	const latestBlock = await getBlockByHash(stateData?.currentBlockHash)
	if (!latestBlock) {
		throw new Error('Block not found')
	}
	return latestBlock
}
