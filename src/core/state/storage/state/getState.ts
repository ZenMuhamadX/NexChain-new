import { blockState } from './setState'
import { hexToString } from 'src/core/encoding/hex/hexToString'
import { HexString } from 'src/types/block'
import { bufferGet } from 'src/core/state/journal/writeBuffer'

export const getBlockState = async (): Promise<blockState | undefined> => {
	// `bufferGet` supaya commit yang sedang berjalan melihat pointer yang
	// sudah ditulisnya sendiri (buffer), bukan nilai pra-blok.
	const data = (await bufferGet('state', 'blockState')) as HexString | null
	if (data) {
		return JSON.parse(hexToString(data)) as blockState
	} else {
		return undefined
	}
}
