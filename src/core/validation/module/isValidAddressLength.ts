import { validateRule } from './validateField'
import { TxInterface } from 'src/types/transaction'

/**
 * Aturan: panjang kedua alamat harus tepat 43 karakter.
 *
 * STAGE 1 FIX: sebelumnya argumen helper dibalik sehingga panjang yang BENAR
 * justru ditolak.
 */
export const validateAddressLengths = (transaction: TxInterface): boolean => {
	return (
		validateRule(
			transaction.sender.length === 43,
			'transactionValidator',
			'Invalid transaction sender length',
		) &&
		validateRule(
			transaction.receiver.length === 43,
			'transactionValidator',
			'Invalid receiver address length',
		)
	)
}
