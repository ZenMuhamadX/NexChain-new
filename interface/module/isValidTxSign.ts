import { recoverSignerAddress } from 'sign/verifySIgnature'
import { validateField } from './validateField'
import { TxInterface } from 'interface/structTx'
import { isContract } from 'nexchain/lib/isContract'
import { ManageContract } from 'contract/manageContract'

/**
 * Validasi signature transaksi.
 *
 * Selain memverifikasi ECDSA, address hasil recover juga WAJIB cocok dengan
 * pemilik `sender` — supaya pihak lain tidak bisa membuat transaksi atas nama
 * orang lain.
 *
 * @param allowContractOwnerFallback jika true dan owner kontrak tidak bisa
 *        dibaca (mis. sisi client yang tidak punya akses DB kontrak), maka
 *        binding address dilewati. Sisi server selalu false sehingga tetap ketat.
 */
export const validateTransactionSignature = async (
	transaction: TxInterface,
	allowContractOwnerFallback: boolean = false,
): Promise<boolean> => {
	if (!transaction.txHash || !transaction.sign) {
		return validateField(
			true,
			'transactionValidator',
			'Invalid signature: missing txHash or sign',
		)
	}

	const signer = recoverSignerAddress(transaction.txHash, transaction.sign)
	if (signer === undefined) {
		return validateField(
			true,
			'transactionValidator',
			'Invalid signature',
		)
	}

	// EOA: signer harus persis pemilik address sender
	if (!isContract(transaction.sender)) {
		if (signer !== transaction.sender) {
			return validateField(
				true,
				'transactionValidator',
				'Signature does not match sender address',
			)
		}
		return true
	}

	// Contract sender: signer harus owner kontrak tsb.
	try {
		const contract = await new ManageContract(
			transaction.sender,
		).getContractData()
		if (signer === contract.owner) return true

		return validateField(
			true,
			'transactionValidator',
			'Signature does not match contract owner',
		)
	} catch {
		// Owner tidak bisa dibaca — hanya boleh jika fallback diizinkan (sisi client)
		if (allowContractOwnerFallback) return true
		return validateField(
			true,
			'transactionValidator',
			'Cannot verify contract owner for signature',
		)
	}
}
