import { Block } from 'src/core/block/blockModel'
import { rocksBlock } from 'src/core/state/db/block'
import { stringToBase58 } from 'src/core/encoding/hex/base58/stringToBase58'

export const writeBlockHash = async (
	blockHash: string,
	blockData: Block,
): Promise<void> => {
	const parsedBlockData = JSON.stringify(blockData, null, 2)
	const encodedBlock = stringToBase58(parsedBlockData)
	// Tulis Buffer ke dalam file dengan nama yang dihasilkan
	await rocksBlock.put(`blockHash:${blockHash}`, encodedBlock, {
		sync: false,
	})
}
