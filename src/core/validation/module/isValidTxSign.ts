import { recoverSignerAddress } from 'src/crypto/verifySignature'
import { validateRule } from './validateField'
import { TxInterface } from 'src/types/transaction'

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
 *
 * STAGE 1 FIX: helper `validateField` diganti `validateRule` yang menerima
 * kondisi yang harus BENAR. Pemanggilan lama memakai `validateField(true, ...)`
 * sebagai "selalu gagal" untuk cabang error; sekarang setiap cabang
 * menyatakan kondisi penolaknya secara eksplisit sehingga tidak mungkin
 * terbalik lagi.
 */
export const validateTransactionSignature = async (
	transaction: TxInterface,
): Promise<boolean> => {
	if (
		!validateRule(
			Boolean(transaction.txHash) && Boolean(transaction.sign),
			'transactionValidator',
			'Invalid signature: missing txHash or sign',
		)
	) {
		return false
	}

	const signer = recoverSignerAddress(transaction.txHash!, transaction.sign!)
	if (
		!validateRule(
			signer !== undefined,
			'transactionValidator',
			'Invalid signature',
		)
	) {
		return false
	}

	return validateRule(
		signer === transaction.sender,
		'transactionValidator',
		'Signature does not match sender address',
	)
}
