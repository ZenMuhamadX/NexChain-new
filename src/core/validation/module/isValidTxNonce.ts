import { TxInterface } from 'src/types/transaction'
import { getAccount } from 'src/wallet/balance/getAccount'
import { loadMempool } from 'src/core/state/storage/mempool/loadMempool'
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

	// Hitung tx sender yang masih pending di mempool
	const mempool = await loadMempool().catch(() => [])
	const pendingCount = Array.isArray(mempool)
		? mempool.filter((tx: TxInterface) => tx.from === transaction.from).length
		: 0

	const expectedNonce = accountNonce + pendingCount

	return validateRule(
		transaction.nonce === expectedNonce,
		'transactionValidator',
		`Invalid nonce: expected ${expectedNonce}, got ${transaction.nonce}`,
	)
}
