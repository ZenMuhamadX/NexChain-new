import { validateRule } from './validateField'
import { TxInterface } from 'interface/structTx'
import { isValidAddress } from 'nexchain/transaction/utils/isValidAddress'

/**
 * Aturan: kedua alamat harus lolos `isValidAddress`.
 *
 * STAGE 1 FIX: sebelumnya argumen helper dibalik sehingga alamat yang VALID
 * justru ditolak dan hanya alamat invalid yang bisa lolos.
 */
export const validateAddresses = (transaction: TxInterface): boolean => {
	return (
		validateRule(
			isValidAddress(transaction.sender),
			'transactionValidator',
			'Invalid transaction sender address',
		) &&
		validateRule(
			isValidAddress(transaction.receiver),
			'transactionValidator',
			'Invalid transaction receiver address',
		)
	)
}
