import { recoverSignerAddress } from 'src/crypto/verifySignature'
import { txSighash, txHashOf } from 'src/core/encoding/rlp/txCodec'
import { validateRule } from './validateField'
import { TxInterface } from 'src/types/transaction'

/**
 * Validasi signature transaksi.
 *
 * Dua pemeriksaan, keduanya penting:
 *
 * 1. **ECDSA atas `sighash`.** Sejak `sighash` dipisah dari `txHash`, yang
 *    ditandatangani adalah `sha256(rlp(field unsigned))` — dihitung ULANG di
 *    sini, bukan dibaca dari field mana pun. Sebelumnya verifikasi memakai
 *    `transaction.txHash` apa adanya, sehingga node mempercayai nilai yang
 *    dikirim client.
 *
 * 2. **Integritas `txHash`.** `txHash` harus sama dengan
 *    `sha256(payload bertipe)` dari transaksi itu. Pemeriksaan ini yang
 *    membuat klaim "txHash mengikat byte yang dikirim" benar-benar berlaku —
 *    tanpa ia, properti itu tidak pernah dipakai. Sekaligus menangkap data
 *    yang diubah setelah ditandatangani (mis. JSON mempool yang disunting).
 *
 * 3. **`signer === sender`.** Address hasil recover WAJIB cocok dengan
 *    pemilik `sender`, supaya pihak lain tidak bisa membuat transaksi atas
 *    nama orang lain. (Pemeriksaan ini hilang di Fase 4, saat `sender`
 *    dihapus dan hasil recover LANGSUNG menjadi `from`.)
 */
export const validateTransactionSignature = async (
	transaction: TxInterface,
): Promise<boolean> => {
	if (
		!validateRule(
			Boolean(transaction.sign),
			'transactionValidator',
			'Invalid signature: missing sign',
		)
	) {
		return false
	}

	if (
		!validateRule(
			transaction.txHash === txHashOf(transaction),
			'transactionValidator',
			'Invalid txHash: does not match the signed payload',
		)
	) {
		return false
	}

	const signer = recoverSignerAddress(txSighash(transaction), transaction.sign!)
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
