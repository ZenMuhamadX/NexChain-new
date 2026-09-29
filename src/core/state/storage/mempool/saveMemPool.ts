import { TxInterface } from 'src/types/transaction'
import { rocksMempool } from 'src/core/state/db/memPool'

export const saveMempool = async (transaction: TxInterface): Promise<void> => {
	if (!transaction) {
		console.log('no data')
		return
	}
	// 1. Simpan transaksi ke LevelDB
	const parseMempool = JSON.stringify(transaction)
	await rocksMempool.put(`0x${transaction.txHash}`, parseMempool, {
		sync: false,
	})
}
