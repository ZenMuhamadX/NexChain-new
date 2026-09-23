import { txInterfaceValidator } from './joi/txInterface'
import { validateTransactionAmount } from 'interface/module/isValidTxAmount'
import { logError } from 'interface/module/writeLog'
import {
	validateTransactionSignature,
	ContractOwnerResolver,
} from 'interface/module/isValidTxSign'
import { getContract } from 'contract/utils/getContract'
import { validateTransactionSenderReceiver } from 'interface/module/isValidTxSenderReciever'
import { validateTransactionFees } from 'interface/module/isValidTxFee'
import { validateTransactionNonce } from 'interface/module/isValidTxNonce'
import { validateAddresses } from 'interface/module/isValidAddress'
import { validateAddressLengths } from 'interface/module/isValidAddressLength'
import { TxInterface } from 'interface/structTx'
import { isNexu } from 'nexchain/nexucoin/isNexu'
import { hasSufficientBalance } from 'account/utils/hasSufficientBalance'

/**
 * Ambil owner kontrak dari DB state (sisi server saja).
 * Contract address yang belum ada di state -> undefined (ditolak oleh validator).
 */
const resolveOwnerFromDb: ContractOwnerResolver = async (contractAddress) => {
	try {
		return (await getContract(contractAddress)).owner
	} catch {
		return undefined
	}
}

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
	// Sisi server: resolver DB -> WAJIB cocok (tanpa fallback)
	if (
		!(
			await validateTransactionSignature(transaction, {
				resolveContractOwner: resolveOwnerFromDb,
			})
		)
	)
		return false

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
