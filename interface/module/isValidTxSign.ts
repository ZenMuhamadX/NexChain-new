import { recoverSignerAddress } from 'sign/verifySIgnature'
import { validateField } from './validateField'
import { TxInterface } from 'interface/structTx'

/**
 * Validasi signature transaksi.
 *
 * Selain memverifikasi ECDSA, address hasil recover juga WAJIB cocok dengan
 * pemilik `sender` — supaya pihak lain tidak bisa membuat transaksi atas
 * nama orang lain (forge).
 *
 * Jalur khusus "contract sender" (resolver owner kontrak dari DB + opsi
 * fallback sisi client) DIHAPUS bersama fitur smart contract: kini SEMUA
 * sender divalidasi dengan satu aturan yang sama — `signer === sender`.
 */
export const validateTransactionSignature = async (
	transaction: TxInterface,
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

	if (signer !== transaction.sender) {
		return validateField(
			true,
			'transactionValidator',
			'Signature does not match sender address',
		)
	}
	return true
}
