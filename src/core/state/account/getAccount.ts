import { structBalance } from 'src/types/balance'
import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { logToConsole } from 'src/logging/logging'
import { HexString } from 'src/types/block'
import { decodeAccount } from 'src/core/encoding/rlp/accountCodec'
import { bufferGet } from 'src/core/state/journal/writeBuffer'

/**
 * Baca akun dari store `state`.
 *
 * Tiga hasil yang SENGAJA dibedakan (dulu semuanya jadi "saldo 0"):
 *   - alamat tidak valid → `undefined`;
 *   - kunci tidak ada     → akun-nol (alamat valid yang belum pernah dibayar);
 *   - error DB / leaf rusak → **throw** (fail-closed). Membaca state yang
 *     tidak bisa di-decode sebagai 0 berarti transaksi berikutnya dibangun di
 *     atas saldo palsu, dan blok tetap "sukses".
 *
 * Lewat `bufferGet`: selama commit, tulisan yang belum di-flush tetap
 * terlihat, jadi tx kedua dari pengirim yang sama membaca saldo setelah debit
 * tx pertama — bukan saldo pra-blok.
 */
export const getAccount = async (
	address: string,
): Promise<structBalance | undefined> => {
	if (!address) {
		logToConsole('Address not provided')
		return
	}
	if (!isValidAddress(address)) {
		logToConsole('Invalid address')
		return
	}

	const value = await bufferGet('state', address)
	// Kunci yang tidak ada (termasuk yang belum di-flush tapi sudah ada di
	// buffer) bernilai `null` — hanya itu yang berarti "akun belum ada".
	if (!value) return createDefaultBalance(address)
	return decodeAccount(value as HexString, address)
}

/** Akun yang belum pernah muncul on-chain: semua nol, bukan "error". */
const createDefaultBalance = (address: string): structBalance => ({
	address,
	balance: 0,
	transactionCount: 0,
	lastTransactionDate: null,
	nonce: 0,
})
