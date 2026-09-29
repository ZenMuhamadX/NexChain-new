import { validateAddresses } from 'src/core/validation/module/isValidAddress'
import { validateAddressLengths } from 'src/core/validation/module/isValidAddressLength'
import { validateTransactionAmount } from 'src/core/validation/module/isValidTxAmount'
import { validateTransactionFees } from 'src/core/validation/module/isValidTxFee'
import { validateTransactionSenderReceiver } from 'src/core/validation/module/isValidTxSenderReciever'
import { validateTransactionSignature } from 'src/core/validation/module/isValidTxSign'
import { logError } from 'src/core/validation/module/writeLog'
import { TxInterface } from 'src/types/transaction'
import { txInterfaceValidator } from 'src/core/validation/joi/txInterface'
import { isNexu } from 'src/core/token/isNexu'
import { clientHasSufficientBalance } from './clientHasSufficient'

export const clientSideTxValidate = async (
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
	// Binding address: signer hasil recover WAJIB == sender (anti-forge).
	if (!(await validateTransactionSignature(transaction))) return false

	if (!validateTransactionSenderReceiver(transaction)) return false

	if (!validateTransactionFees(transaction)) return false

	if (!validateAddresses(transaction)) return false

	if (!validateAddressLengths(transaction)) return false

	if (!isNexu(transaction.amount)) return false

	if (
		!(await clientHasSufficientBalance(
			transaction.sender,
			transaction.amount,
			transaction.fee!,
		))
	) {
		return false
	}
	return true
}
