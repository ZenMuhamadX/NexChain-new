import { validateRule } from './validateField'
import { TxInterface } from 'src/types/transaction'

/**
 * Aturan fee (STAGE 1):
 *   1. fee tidak boleh negatif (guard fail-closed, lihat catatan);
 *   2. fee tidak boleh melebihi jumlah transaksi (aturan bisnis yang sudah
 *      disepakati sejak awal, dipertahankan agar Stage 1 tidak mengubah
 *      economics jaringan).
 *
 * STAGE 1 FIX: sebelumnya argumen helper dibalik sehingga fee yang
 * MELEBIHI amount justru lolos, sedangkan fee wajar ditolak.
 *
 * Catatan fail-closed: fee negatif pernah lolos karena tidak ada sama sekali
 * pemeriksaan tanda. Before Stage 1 hal ini tidak bisa dieksploitasi karena
 * amount positif selalu ditolak lebih dulu; setelah Stage 1 amount positif
 * menjadi legal, sehingga guard `fee >= 0` WAJIB ikut dipasang di commit yang
 * sama agar tidak membuka celah baru.
 *
 * TODO(Stage 2): fee harus berupa integer safe, dan kebijakan minimum fee /
 * fee-rate diarahkan ke sini.
 */
export const validateTransactionFees = (transaction: TxInterface): boolean => {
	return (
		validateRule(
			transaction.fee! >= 0,
			'transactionValidator',
			'Invalid transaction fee: fee must not be negative',
		) &&
		validateRule(
			transaction.fee! <= transaction.amount,
			'transactionValidator',
			'Invalid transaction fee',
		)
	)
}
