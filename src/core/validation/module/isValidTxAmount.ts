import { validateRule } from './validateField'
import { TxInterface } from 'src/types/transaction'

/**
 * Aturan: jumlah transaksi harus lebih besar dari nol.
 *
 * STAGE 1 FIX: kondisi yang严格要求 `amount > 0`. Sebelumnya argumen helper
 * dibalik sehingga `amount <= 0` yang dianggap "lolos", membuat setiap
 * transaksi dengan amount positif ditolak.
 */
export const validateTransactionAmount = (
	transaction: TxInterface,
): boolean => {
	return validateRule(
		transaction.amount > 0,
		'transactionValidator',
		'Invalid transaction amount',
	)
}
