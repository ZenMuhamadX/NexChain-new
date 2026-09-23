import { recoverSignerAddress } from 'sign/verifySIgnature'
import { validateField } from './validateField'
import { TxInterface } from 'interface/structTx'
import { isContract } from 'nexchain/lib/isContract'

/**
 * Resolver untuk mengambil owner sebuah kontrak.
 *
 * Sengaja DI-INJECT, bukan di-import langsung: import `ManageContract`
 * akan menarik modul DB (level/rocksdb) ke dalam bundle browser.
 * Sisi server menyediakan resolver berbasis DB; sisi client tidak menyediakannya
 * (fallback), karena validasi ketat tetap dilakukan oleh node.
 */
export type ContractOwnerResolver = (
	contractAddress: string,
) => Promise<string | undefined>

export interface SignatureValidationOptions {
	/**
	 * Jika true dan owner kontrak tidak bisa dibaca (mis. sisi client yang
	 * tidak punya akses DB kontrak), binding address untuk sender tipe kontrak
	 * dilewati. Sisi server selalu false -> tetap ketat.
	 */
	allowContractOwnerFallback?: boolean
	resolveContractOwner?: ContractOwnerResolver
}

/**
 * Validasi signature transaksi.
 *
 * Selain memverifikasi ECDSA, address hasil recover juga WAJIB cocok dengan
 * pemilik `sender` - supaya pihak lain tidak bisa membuat transaksi atas nama
 * orang lain (forge).
 */
export const validateTransactionSignature = async (
	transaction: TxInterface,
	options: SignatureValidationOptions = {},
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
	const owner = options.resolveContractOwner
		? await options
				.resolveContractOwner(transaction.sender)
				.catch(() => undefined)
		: undefined

	if (owner !== undefined) {
		if (signer === owner) return true
		return validateField(
			true,
			'transactionValidator',
			'Signature does not match contract owner',
		)
	}

	// Owner tidak bisa dibaca -> hanya boleh bila fallback diizinkan (sisi client)
	if (options.allowContractOwnerFallback) return true
	return validateField(
		true,
		'transactionValidator',
		'Cannot verify contract owner for signature',
	)
}
