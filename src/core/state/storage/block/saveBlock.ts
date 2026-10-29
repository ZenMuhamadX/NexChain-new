/** @format */
import { Block } from 'src/core/block/blockModel'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { prepareBlockState } from '../state/setState'
import { writeBlockHash } from './writeBlockHash'
import { bufferBatch } from 'src/core/state/journal/writeBuffer'

/**
 * Simpan blok hasil commit — semua tulisan lewat write-buffer.
 *
 * ## Mengapa tidak menulis langsung
 *
 * Sebelumnya jalur ini MEMISAHKAN tiga `put` bersambung:
 * `blockHash:<hash>` (DB blok) → `blockHeight:<n>` (DB state) →
 * `blockState` (DB state). Crash di antara put meninggalkan blok SETENGAH:
 * indeks height menunjuk hash yang badannya belum ada, atau `blockState`
 * sudah di blok baru sementara indeks height tertinggal — membohongi
 * pembaca (boot/`verifyChainIntegrity`) dengan rantai yang "ada" tetapi
 * tidak konsisten.
 *
 * Sekarang ketiganya masuk buffer commit dan di-flush per store dengan
 * `sync:true` SETELAH WAL ditulis, jadi crash di tengah berarti rollback
 * (bukan blok setengah). `prepareBlockState` tetap berjalan lebih dulu supaya
 * pelanggaran plafon suplai ditolak sebelum satu byte pun ditulis.
 */
export const saveBlock = async (blockData: Block): Promise<boolean> => {
	try {
		const blockHash = blockData.block.header.hash
		const blockHeight = blockData.block.height

		// (1) Guard plafon suplai dulu, nol tulis.
		const blockState = await prepareBlockState(blockData)

		// (2) Badan blok, lalu (3) indeks height + pointer state dalam SATU
		// batch: pasangan yang paling berbahaya bila berjauhan (state menunjuk
		// blok yang badannya belum ada) tidak bisa berjauhan. Di dalam commit
		// keduanya masuk write-buffer; di luar commit (genesis) batch-nya
		// langsung, sync.
		await writeBlockHash(blockHash, blockData)
		await bufferBatch('state', [
			{ key: `blockHeight:${blockHeight}`, value: blockHash },
			{ key: 'blockState', value: stringToHex(JSON.stringify(blockState)) },
		])
		return true
	} catch (error) {
		// Tangani error jika proses penyimpanan gagal
		console.error('Error saving block:', error)
		return false
	}
}
