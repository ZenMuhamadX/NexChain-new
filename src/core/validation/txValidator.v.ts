import { txInterfaceValidator } from './joi/txInterface'
import { validateTransactionAmount } from 'src/core/validation/module/isValidTxAmount'
import { logError } from 'src/core/validation/module/writeLog'
import { validateTransactionSignature } from 'src/core/validation/module/isValidTxSign'
import { validateTransactionSenderReceiver } from 'src/core/validation/module/isValidTxSenderReciever'
import { validateTransactionFees } from 'src/core/validation/module/isValidTxFee'
import { validateTransactionNonce } from 'src/core/validation/module/isValidTxNonce'
import { validateAddresses } from 'src/core/validation/module/isValidAddress'
import { validateAddressLengths } from 'src/core/validation/module/isValidAddressLength'
import { TxInterface } from 'src/types/transaction'
import { isNexu } from 'src/core/token/isNexu'
import { hasSufficientBalance } from 'src/wallet/utils/hasSufficientBalance'

export const transactionValidator = async (
	transaction: TxInterface,
): Promise<boolean> => {
	const { error } = txInterfaceValidator.validate(transaction)

	if (error || !validateTransactionAmount(transaction)) {
		return logError(
			'transactionValidator',
			'Invalid transaction',
			error?.message || 'Invalid transaction amount',
		)
	}
	// Signature ketat: `from` (hasil ecrecover) WAJIB konsisten dengan tanda
	// tangan (jalur resolver owner kontrak dihapus bersama fitur smart
	// contract).
	if (!(await validateTransactionSignature(transaction))) return false

	if (!validateTransactionSenderReceiver(transaction)) return false

	if (!validateTransactionFees(transaction)) return false

	if (!validateAddresses(transaction)) return false

	if (!validateAddressLengths(transaction)) return false

	if (!isNexu(transaction.amount)) return false

	// Nonce check: cegah replay & urutan transaksi yang salah
	if (!(await validateTransactionNonce(transaction))) return false

	if (
		!(await hasSufficientBalance(
			transaction.from!,
			transaction.amount,
			transaction.fee!,
		))
	) {
		return logError(
			'transactionValidator',
			'Insufficient balance',
			'Insufficient balance',
		)
	}

	// Tidak ada lagi penulisan `status`/`isValid`/`isPending`: ketiganya bukan
	// bagian transaksi. "Sudah dikonfirmasi" diturunkan dari keanggotaan blok
	// (`isTxExecuted` membaca `metadata.blockHeight`).
	return true
}
