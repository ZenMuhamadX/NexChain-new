import { TxInterface } from 'interface/structTx'
import { validateField } from './validateField'
import { getAccount } from 'account/balance/getAccount'
import { loadMempool } from 'nexchain/storage/mempool/loadMempool'
import { isValidAddress } from 'nexchain/transaction/utils/isValidAddress'

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
	if (!Number.isInteger(transaction.nonce) || transaction.nonce < 0) {
		return validateField(
			true,
			'transactionValidator',
			'Invalid transaction nonce',
		)
	}

	// Pengirim non-standar (mis. "COINBASE") tidak punya akun → skip nonce
	if (!isValidAddress(transaction.sender)) return true

	const account = await getAccount(transaction.sender)
	const accountNonce = account?.nonce ?? 0

	// Hitung tx sender yang masih pending di mempool
	const mempool = await loadMempool().catch(() => [])
	const pendingCount = Array.isArray(mempool)
		? mempool.filter((tx: TxInterface) => tx.sender === transaction.sender)
				.length
		: 0

	const expectedNonce = accountNonce + pendingCount

	if (transaction.nonce !== expectedNonce) {
		return validateField(
			true,
			'transactionValidator',
			`Invalid nonce: expected ${expectedNonce}, got ${transaction.nonce}`,
		)
	}

	return true
}
