import { TxInterface } from 'src/types/transaction'
import { getAccount } from 'src/core/state/account/getAccount'
import {
	countPendingBySender,
	findPendingByNonce,
} from 'src/core/state/storage/mempool/mempoolIndex'
import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { validateRule } from './validateField'

/**
 * Validasi nonce transaksi terhadap akun dan tx yang masih pending.
 *
 * Aturan:
 * - nonce akun (confirmed) = N (di-increment oleh processSender setelah mining)
 * - tx.confirmed ke-n punya nonce = N-1
 * - transaksi baru wajib nonce >= N
 * - untuk tx yang masih menumpuk di mempool, nonce harus berurutan tanpa gap:
 *   nonce = N + (jumlah tx sender yang sudah ada di mempool)
 *
 * Ini mencegah replay dan urutan transaksi yang salah.
 */
export const validateTransactionNonce = async (
	transaction: TxInterface,
): Promise<boolean> => {
	if (
		!validateRule(
			Number.isInteger(transaction.nonce) && transaction.nonce >= 0,
			'transactionValidator',
			'Invalid transaction nonce',
		)
	) {
		return false
	}

	// Pengirim non-standar tidak punya akun → skip nonce. (Sejak coinbase
	// keluar dari daftar transaksi, `from` selalu alamat hasil `ecrecover`
	// yang sah, jadi cabang ini praktis tidak pernah terpakai — disimpan
	// sebagai jaring pengaman.)
	if (!isValidAddress(transaction.from!)) return true

	const account = await getAccount(transaction.from!)
	const accountNonce = account?.nonce ?? 0

	// Hitung tx sender yang masih pending — memakai indeks per-pengirim
	// (`countPendingBySender`), BUKAN `loadMempool` yang terpotong 100
	// entri secara global. Cacat lama (audit P1 #4): saat mempool melebihi
	// 100 tx, jumlah milik pengirim ini bisa terpotong → ekspektasi nonce
	// salah → nonce kembar lolos (transaksi kembar) atau reserve pending
	// menumpuk tanpa dilepas (dana terkunci).
	const pendingCount = await countPendingBySender(transaction.from!)

	const expectedNonce = accountNonce + pendingCount

	if (transaction.nonce === expectedNonce) return true

	// Penggantian (RBF): nonce yang SUDAH DITEMPATI tx pending pengirim ini
	// bukan slot baru — jumlah pending tidak berubah, jadi rumus
	// `akun.nonce + jumlah pending` memang tidak berlaku untuknya. Kebijakan
	// penggantian (laju-fee lebih tinggi, cap, reserve) dinilai admission
	// (`memPool.doAddTransaction`); di sini cukup bahwa slot itu memang sudah
	// terisi. Nonce basi (nonce < akun.nonce) TIDAK ditempati → tetap ditolak,
	// begitu pula nonce berlubang di atas ekspektasi.
	const occupied = await findPendingByNonce(
		transaction.from!,
		transaction.nonce,
	)
	if (occupied) return true

	return validateRule(
		false,
		'transactionValidator',
		`Invalid nonce: expected ${expectedNonce}, got ${transaction.nonce}`,
	)
}
