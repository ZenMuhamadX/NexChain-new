import { Block } from 'src/core/block/blockModel'
import { rocksBlock } from 'src/core/state/db/block'
import { stringToBase58 } from 'src/core/encoding/hex/base58/stringToBase58'
import { assertJournalAllows } from 'src/core/state/journal/guard'

export const writeBlockHash = async (
	blockHash: string,
	blockData: Block,
): Promise<void> => {
	// Journal guard (fail-closed): badan blok WAJIB terenumerasi.
	assertJournalAllows('block', `blockHash:${blockHash}`)
	const parsedBlockData = JSON.stringify(blockData, null, 2)
	const encodedBlock = stringToBase58(parsedBlockData)
	// `sync: true` — tulisan ini adalah WRITE-AHEAD badan blok di jalur
	// commit: badan wajib benar-benar berada di disk SEBELUM batch state
	// (`blockHeight:`/`blockState`) merujuknya. Bila tetap async, crash
	// bisa mengabulkan state sementara badan hilang — persis cacat
	// "blockHeight ada tapi blockHash tidak" (lihat catatan di `saveBlock`).
	await rocksBlock.put(`blockHash:${blockHash}`, encodedBlock, {
		sync: true,
	})
}
