import { txInterfaceValidator } from './joi/txInterface'
import { validateTransactionAmount } from 'interface/module/isValidTxAmount'
import { logError } from 'interface/module/writeLog'
import { validateTransactionSignature } from 'interface/module/isValidTxSign'
import { validateTransactionSenderReceiver } from 'interface/module/isValidTxSenderReciever'
import { validateTransactionFees } from 'interface/module/isValidTxFee'
import { validateTransactionNonce } from 'interface/module/isValidTxNonce'
import { validateAddresses } from 'interface/module/isValidAddress'
import { validateAddressLengths } from 'interface/module/isValidAddressLength'
import { TxInterface } from 'interface/structTx'
import { isNexu } from 'nexchain/nexucoin/isNexu'
import { hasSufficientBalance } from 'account/utils/hasSufficientBalance'

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
	// Signature ketat: signer hasil recover WAJIB == sender (jalur resolver
	// owner kontrak dihapus bersama fitur smart contract).
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
			transaction.sender,
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

	transaction.status = 'pending'
	transaction.isValid = true
	transaction.isPending = true
	return true
}
