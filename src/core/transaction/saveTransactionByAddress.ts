import { decodeFromBytes } from 'src/core/encoding/hex/bytes/decodeBytes'
import { rocksHistory } from 'src/core/state/db/history'
import {
	assertJournalAllows,
	isJournalGuardError,
} from 'src/core/state/journal/guard'

export const saveTxByAddress = async (
	from: string,
	receiver: string,
	txHash: string,
): Promise<void> => {
	// Journal guard (fail-closed): di LUAR try — kedua kunci indeks alamat
	// WAJIB terenumerasi. Guard error dilempar-ulang oleh catch di bawah.
	assertJournalAllows('history', `address:${from}`)
	assertJournalAllows('history', `address:${receiver}`)
	try {
		// Cek dan tambahkan txHash untuk pengirim
		await addTxHashToAddress(from, txHash)

		// Cek dan tambahkan txHash untuk penerima
		await addTxHashToAddress(receiver, txHash)
	} catch (error) {
		if (isJournalGuardError(error)) throw error
		console.error('Error indexing transaction:', error)
	}
}

const addTxHashToAddress = async (
	address: string,
	txHash: string,
): Promise<void> => {
	try {
		// Cek apakah alamat sudah ada di database
		const existingTxHashes: Buffer = (await rocksHistory
			.get(`address:${address}`, {
				fillCache: true,
			})
			.catch(() => null)) as unknown as Buffer

		let newTxHashes: string[]

		if (!existingTxHashes) {
			// Jika alamat tidak ada, buat entry baru
			newTxHashes = [txHash]
		} else {
			// Jika alamat ada, ambil existing txHash array
			newTxHashes = JSON.parse(decodeFromBytes(existingTxHashes))

			// Tambahkan txHash baru jika belum ada (untuk menghindari duplikasi)
			if (!newTxHashes.includes(txHash)) {
				newTxHashes.push(txHash)
			}
		}

		// Simpan array yang diperbarui kembali ke LevelDB
		await rocksHistory.put(`address:${address}`, JSON.stringify(newTxHashes))
	} catch (error) {
		if (isJournalGuardError(error)) throw error
		console.error(`Error adding txHash to address ${address}:`, error)
	}
}
