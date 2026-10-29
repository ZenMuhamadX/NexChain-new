import { Block } from 'src/core/block/blockModel'
import { stringToBase58 } from 'src/core/encoding/hex/base58/stringToBase58'
import { bufferPut } from 'src/core/state/journal/writeBuffer'

export const writeBlockHash = async (
	blockHash: string,
	blockData: Block,
): Promise<void> => {
	const parsedBlockData = JSON.stringify(blockData, null, 2)
	const encodedBlock = stringToBase58(parsedBlockData)
	// Di jalur commit ini masuk write-buffer: badan blok ikut undo journal dan
	// di-flush (sync) sebelum batch state yang merujuknya. Di luar commit
	// (bootstrap genesis) langsung ke DB.
	await bufferPut('block', `blockHash:${blockHash}`, encodedBlock)
}
