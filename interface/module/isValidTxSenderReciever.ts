import { validateRule } from './validateField'
import { TxInterface } from 'interface/structTx'

/**
 * Aturan: pengirim dan penerima harus BERBEDA.
 *
 * STAGE 1 FIX: kondisi yang diminta adalah `sender !== receiver`. Sebelumnya
 * kondisinya `sender === receiver`, sehingga transaksi self-transfer yang tidak
 * seharusnya lolos justru dianggap valid dan transfer antar-alamat yang
 * seharusnya legal justru ditolak.
 */
export const validateTransactionSenderReceiver = (
	transaction: TxInterface,
): boolean => {
	return validateRule(
		transaction.sender !== transaction.receiver,
		'transactionValidator',
		'Invalid transaction sender and receiver',
	)
}
