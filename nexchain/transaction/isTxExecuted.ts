import { getHistoryByTxHash } from 'nexchain/block/query/onChain/Transaction/getHistoryByTxHash'

/**
 * Apakah txHash ini SUDAH pernah dieksekusi di blok?
 *
 * Semantik `status` pada history transaksi:
 * - `'pending'`   : ditulis saat transaksi MASUK mempool (admission,
 *                   `MemPool.addTransaction`) — belum dieksekusi;
 * - `'confirmed'` : ditulis `processTransact` SESUDAH eksekusi berhasil —
 *                   sudah dieksekusi.
 *
 * Dipakai sebagai penjaga idempotensi: transaksi yang tersisa di mempool
 * (crash tepat setelah `saveTxHistory` tetapi sebelum `removeMemPool`,
 * atau artefak race snapshot lama) tidak akan dieksekusi dua kali di
 * blok berikutnya — cukup dibersihkan dari mempool.
 */
export const isTxExecuted = async (txHash: string): Promise<boolean> => {
	if (!txHash) return false
	try {
		const history = await getHistoryByTxHash(txHash, 'json')
		if (typeof history === 'string') return false // enc hex — bukan objek
		return history.status === 'confirmed'
	} catch {
		// Tidak ada riwayat = belum pernah dieksekusi.
		return false
	}
}
