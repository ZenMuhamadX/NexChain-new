import { rocksState } from 'src/core/state/db/state'
import { blockState } from './setState'
import { hexToString } from 'src/core/encoding/hex/hexToString'
import { HexString } from 'src/types/block'

export const getBlockState = async (): Promise<blockState | undefined> => {
	const data = (await rocksState.get(`blockState`, {
		fillCache: true,
	})) as HexString
	if (data) {
		return JSON.parse(hexToString(data)) as blockState
	} else {
		return undefined
	}
}
