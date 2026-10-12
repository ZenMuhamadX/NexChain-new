import { comTxInterface } from 'src/types/compositeTransaction'
import { TxInterface } from 'src/types/transaction'
import { toNexu } from 'src/core/token/toNexu'

/** Minimum amount setelah konversi format, dalam nexu. */
export const MIN_AMOUNT_NEXU = 1

export interface UnsignedTransactionResult {
	status: boolean
	/** Transaksi BELUM di-sign (`sign` masih placeholder nol). */
	tx?: TxInterface
	error?: string
}

/**
 * Bangun transaksi UNSIGNED — **fungsi murni**.
 *
 * Tidak ada I/O sama sekali: tidak ada RPC (nonce diterima sebagai argumen),
 * tidak ada filesystem, tidak ada wallet.
 *
 * Yang berubah dari versi lama:
 *
 *   - `sender` TIDAK lagi ikut transaksi. Pengirim adalah hasil `ecrecover`
 *     atas tanda tangan, jadi ia baru ada setelah `signTransaction` — dan
 *     tidak pernah dikirim di wire. `comTxInterface.sender` tetap dipakai
 *     pemanggil untuk mengambil nonce (itu alamat user sendiri), tapi bukan
 *     bagian transaksi on-chain.
 *   - `txHash` TIDAK lagi dihitung di sini. Ia turunan dari byte yang sudah
 *     ditandatangani, jadi baru ada setelah `signTransaction`.
 *   - `hexInput` dihapus — turunan, tidak pernah diverifikasi siapa pun.
 *   - `timestamp` dihapus — waktu transaksi milik blok.
 *   - `format` tidak ikut on-chain; ia hanya satuan masukan untuk konversi.
 *   - `extraMessage` menjadi `data` opsional (bytes), tanpa nilai default.
 *   - `status`/`isValid`/`isPending` dihapus — state siklus hidup diturunkan
 *     dari fakta rantai, bukan disimpan di transaksi.
 *
 * Alur pemanggil:
 *
 *   nonce  = await getNonce(sender)                    // I/O pemanggil
 *   tx     = createUnsignedTransaction(input, nonce)   // murni (di sini)
 *   signed = signTransaction(tx, privateKey)           // murni
 *   await sendRaw(encodeTx(signed))                    // I/O pemanggil
 */
export const createUnsignedTransaction = (
	transaction: comTxInterface,
	nonce: number,
): UnsignedTransactionResult => {
	// Konversi amount ke nexu bila satuannya NXC.
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

	const tx: TxInterface = {
		nonce,
		fee: transaction.fee,
		receiver: transaction.receiver,
		amount: convertedAmount,
		...(transaction.data === undefined ? {} : { data: transaction.data }),
		// Placeholder berformat sah (64 hex) supaya kodek RLP bisa meng-encode
		// transaksi yang belum ditandatangani tanpa melempar; `signTransaction`
		// menggantinya dengan tanda tangan sungguhan.
		sign: { v: 0, r: '0'.repeat(64), s: '0'.repeat(64) },
	}

	return { status: true, tx }
}
