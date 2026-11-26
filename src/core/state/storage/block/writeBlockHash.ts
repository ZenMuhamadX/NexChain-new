import { Block } from 'src/core/block/blockModel'
import { encodeBlock } from 'src/core/encoding/hex/block/encodeBlock'
import { bufferPut } from 'src/core/state/journal/writeBuffer'

export const writeBlockHash = async (
	blockHash: string,
	blockData: Block,
): Promise<void> => {
	// Badan blok disimpan sebagai RLP (format yang sama dengan wire P2P),
	// bukan JSON+base58: sekitar separuh ukuran dan decode jauh lebih murah
	// saat boot replay membaca seluruh rantai.
	const encodedBlock = encodeBlock(blockData.block)
	// Di jalur commit ini masuk write-buffer: badan blok ikut undo journal dan
	// di-flush (sync) sebelum batch state yang merujuknya. Di luar commit
	// (bootstrap genesis) langsung ke DB.
	await bufferPut('block', `blockHash:${blockHash}`, encodedBlock)
}
