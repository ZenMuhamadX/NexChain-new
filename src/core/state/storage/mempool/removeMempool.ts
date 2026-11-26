import { isSimulation } from 'src/core/state/journal/writeBuffer'
import { deleteMempoolTx } from './mempoolStore'

/**
 * Buang transaksi dari mempool RAM beserta indeks per-pengirimnya.
 *
 * `from` dibaca dari transaksi yang tersimpan (bukan parameter), sehingga
 * pemanggil yang hanya punya `txHash` tetap membersihkan indeks.
 */
export const removeMemPool = async (txHash: string): Promise<void> => {
	if (!txHash) return
	// Simulasi (template/replay) TIDAK boleh menghapus tx: template yang tak
	// pernah ditambang, atau replay saat boot, tidak berarti tx sudah masuk
	// blok. Mempool hanya berubah saat commit nyata.
	if (isSimulation()) return
	deleteMempoolTx(txHash)
}
