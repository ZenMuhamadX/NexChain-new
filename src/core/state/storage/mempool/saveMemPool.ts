import { TxInterface } from 'src/types/transaction'
import { putMempoolTx, deleteMempoolTx } from './mempoolStore'

/**
 * Simpan transaksi ke mempool RAM beserta indeks per-pengirimnya.
 *
 * Tidak ada I/O disk: dulu ini satu batch LevelDB `sync:false` per admission.
 */
export const saveMempool = async (transaction: TxInterface): Promise<void> => {
	if (!transaction) {
		console.log('no data')
		return
	}
	if (!transaction.txHash || !transaction.from) {
		console.error('saveMempool: txHash & from wajib ada sebelum menyimpan')
		return
	}
	putMempoolTx(transaction)
}

/**
 * Ganti tx pending dengan penggantinya (RBF).
 *
 * Kebijakan TIDAK dinilai di sini: pemanggil (`memPool.doAddTransaction`)
 * sudah memastikan laju-fee pengganti lebih tinggi dan `oldTxHash` memang tx
 * pending milik `from` yang sama.
 */
export const replaceMempool = async (
	oldTxHash: string,
	transaction: TxInterface,
): Promise<void> => {
	if (!oldTxHash || !transaction.txHash || !transaction.from) {
		console.error('replaceMempool: txHash & from wajib ada sebelum menyimpan')
		return
	}
	deleteMempoolTx(oldTxHash)
	putMempoolTx(transaction)
}
