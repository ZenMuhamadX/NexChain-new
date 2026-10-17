import { getHistoryByTxHash } from 'src/core/block/query/onChain/Transaction/getHistoryByTxHash'

/**
 * Bentuk entri riwayat yang kita butuhkan: metadata asal blok.
 * (`getHistoryByTxHash` mengembalikan `TxInterface`, sementara `metadata`
 * ditambahkan `processTransact` saat eksekusi.)
 */
interface HistoryWithBlockRef {
	metadata?: {
		blockHeight?: number
	}
}

/**
 * Apakah txHash ini SUDAH pernah dieksekusi di sebuah blok?
 *
 * Diturunkan dari **keanggotaan blok**, bukan dari flag: entri riwayat yang
 * punya `metadata.blockHeight` berarti transaksinya sudah masuk blok.
 *
 * Sebelumnya penandanya adalah `status === 'confirmed'` — nilai mutable yang
 * harus ditulis jalur tertentu. `blockHeight` adalah fakta rantai (ground
 * truth), jadi penjaga idempotensi tidak lagi bergantung pada nilai yang bisa
 * ditulis keliru.
 *
 * Dipakai untuk dua hal:
 *   - transaksi yang tersisa di mempool (crash tepat setelah `saveTxHistory`
 *     tetapi sebelum `removeMemPool`) tidak dieksekusi dua kali;
 *   - hadiah blok tidak dikredit dua kali bila proses diulang.
 */
export const isTxExecuted = async (txHash: string): Promise<boolean> => {
	if (!txHash) return false
	try {
		const history = await getHistoryByTxHash(txHash)
		const withMeta = history as HistoryWithBlockRef
		return typeof withMeta.metadata?.blockHeight === 'number'
	} catch {
		// Tidak ada riwayat = belum pernah dieksekusi.
		return false
	}
}
