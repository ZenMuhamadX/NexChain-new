import { Block } from 'src/core/block/blockModel'
import { rocksBlock } from 'src/core/state/db/chain'
import { decodeBlock } from 'src/core/encoding/hex/block/decodeBlock'

export const getBlockByHash = async (
	hash: string,
): Promise<Block | undefined> => {
	const encodedBlock = (await rocksBlock.get(`blockHash:${hash}`, {
		fillCache: true,
	})) as string | undefined
	// `level` v10 me-resolve `undefined` untuk kunci yang tidak ada.
	if (!encodedBlock) return undefined
	return new Block(decodeBlock(encodedBlock))
}
