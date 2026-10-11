import { createTxnHash } from 'src/core/transaction/createTransactionHash'
import { comTxInterface } from 'src/types/compositeTransaction'
import { TxInterface } from 'src/types/transaction'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { toNexu } from 'src/core/token/toNexu'
// Konstanta protokol tinggal di core/ karena ikut di-hash DAN dipakai oleh
// codec wire (`core/encoding/rlp/txCodec`). core/ tidak boleh bergantung ke
// client/, jadi rumahnya harus di core.
import { DEFAULT_EXTRA_MESSAGE } from 'src/core/transaction/constants'

/** Minimum amount setelah konversi format, dalam nexu. */
export const MIN_AMOUNT_NEXU = 1

export interface UnsignedTransactionResult {
	status: boolean
	/** Transaksi BELUM di-sign (`sign` masih placeholder kosong). */
	tx?: TxInterface
	error?: string
}

/**
 * Bangun transaksi UNSIGNED — **fungsi murni**.
 *
 * Tidak ada I/O sama sekali: tidak ada RPC (nonce diterima sebagai argumen),
 * tidak ada filesystem, tidak ada wallet. Prasyaratnya hanya data transaksi
 * dan nonce yang sudah diambil pemanggil.
 *
 * Dipisah dari `createTransaction` supaya wallet browser bisa menyusun
 * transaksi tanpa menarik `fs`/`path` (via `loadWallet`) ke dalam bundle.
 * Alur browser:
 *
 *   nonce  = await getNonce(sender)            // I/O di sisi pemanggil
 *   tx     = createUnsignedTransaction(tx, nonce)  // murni (di sini)
 *   signed = signTransaction(tx, privateKey)       // murni
 *   await sendRaw(encodeTx(signed))                // I/O di sisi pemanggil
 *
 * `txHash` dihitung DI SINI (sudah termasuk `nonce`, belum termasuk `sign`,
 * karena `sign` justru menandatangani `txHash` tersebut).
 */
export const createUnsignedTransaction = (
	transaction: comTxInterface,
	nonce: number,
): UnsignedTransactionResult => {
	// Konversi amount ke Nexu jika formatnya adalah NXC
	const convertedAmount =
		transaction.format === 'NXC'
			? toNexu(transaction.amount)
			: transaction.amount

	if (convertedAmount < MIN_AMOUNT_NEXU) {
		return {
			status: false,
			error: 'Transaction amount must be at least 1 nexu.',
		}
	}

	const completedTx: TxInterface = {
		format: 'nexu',
		amount: convertedAmount,
		receiver: transaction.receiver,
		sender: transaction.sender,
		timestamp: transaction.timestamp,
		fee: transaction.fee,
		nonce,
		isPending: true,
		isValid: false,
		extraMessage: transaction.extraMessage || DEFAULT_EXTRA_MESSAGE,
		status: 'pending',
		sign: { r: '', s: '', v: 0 },
	}

	// Hash dulu (sudah termasuk nonce), baru hexInput — sama seperti urutan lama.
	completedTx.txHash = createTxnHash(completedTx)
	completedTx.hexInput = stringToHex(
		JSON.stringify({
			format: completedTx.format,
			amount: completedTx.amount,
			receiver: completedTx.receiver,
			sender: completedTx.sender,
			timestamp: completedTx.timestamp,
		}),
	)

	return { status: true, tx: completedTx }
}
