import { Block } from 'src/core/block/blockModel'
import { bufferPut } from 'src/core/state/journal/writeBuffer'

export const writeBlockHash = async (
	blockHash: string,
	blockData: Block,
): Promise<void> => {
	// base58 (bs58) memakai BigInt: 200 KB ≈ 95 detik, 1 MB ≈ berjam-jam.
	// Badan blok 1.000 tx jadi simpan sebagai JSON padat; awalan `j:` dibaca
	// `getBlockByHash`, blok lama tanpa awalan tetap di-decode base58.
	const encodedBlock = `j:${JSON.stringify(blockData)}`
	// Di jalur commit ini masuk write-buffer: badan blok ikut undo journal dan
	// di-flush (sync) sebelum batch state yang merujuknya. Di luar commit
	// (bootstrap genesis) langsung ke DB.
	await bufferPut('block', `blockHash:${blockHash}`, encodedBlock)
}
