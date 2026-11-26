import { TxInterface } from 'src/types/transaction'
import { hexToString } from 'src/core/encoding/hex/hexToString'
import { HexString } from 'src/types/block'
import { bufferGet } from 'src/core/state/journal/writeBuffer'
import { readMempoolEntry } from 'src/core/state/storage/mempool/mempoolIndex'

export const getHistoryByTxHash = async (
	txHash: string,
): Promise<TxInterface> => {
	// `bufferGet`: selama commit/replay, riwayat yang baru ditulis blok ini
	// harus terlihat. Tanpa itu replay membaca riwayat DB lama → mengira tx
	// sudah dieksekusi → melewatinya → saldo hasil replay salah.
	const data = await bufferGet('history', `txnHash:${txHash}`)
	if (data) return JSON.parse(hexToString(data as HexString))
	// Tx yang masih pending tidak lagi ditulis ke store riwayat saat
	// admission; lookup publik tetap harus menemukannya.
	const pending = await readMempoolEntry(txHash)
	if (pending) return pending
	throw new Error(`History not found for ${txHash}`)
}
