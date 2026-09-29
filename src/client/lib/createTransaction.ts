import { comTxInterface } from 'src/types/compositeTransaction'
import { TxInterface } from 'src/types/transaction'
import { loadWallet } from 'src/wallet/utils/loadWallet'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { logToConsole } from 'src/logging/logging'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { getNonce } from 'src/client/rpc-client/controller/rpcGetNonce'
import { createUnsignedTransaction } from './createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'

export interface returnData {
	status: boolean
	txHash?: string | undefined
	base64Data: string | undefined
	rawData: TxInterface | undefined
}

/**
 * Convenience wrapper untuk **CLI / Node**.
 *
 * Phase B memisahkan jalur transaksi jadi dua fungsi murni:
 *   - `createUnsignedTransaction(tx, nonce)` — menyusun transaksi + txHash
 *   - `signTransaction(tx, privateKey)`      — menandatangani
 *
 * Wrapper ini hanya MENYUSUN I/O di sekitarnya:
 *   1. ambil nonce dari node           (async, jaringan)
 *   2. bangun transaksi                (murni)
 *   3. ambil private key dari file     (filesystem — KHUSUS Node/CLI)
 *   4. tanda tangani                   (murni)
 *   5. encode ke base64                (murni)
 *
 * Wallet BROWSER tidak melewati langkah 3: ia memanggil langkah 2 dan 4
 * langsung dengan private key miliknya sendiri, sehingga `loadWallet`
 * (fs/path) tidak pernah ikut ter-bundle.
 *
 * Catatan perubahan kecil dari versi sebelumnya: nonce kini diambil SEBELUM
 * amount divalidasi, jadi transaksi ber-amount < 1 nexu ikut memicu satu
 * panggilan nonce yang hasilnya dibuang. Hasil akhirnya sama persis.
 */
export const createTransaction = async (
	transaction: comTxInterface,
): Promise<returnData> => {
	// 1. I/O — query nonce dari node
	const nonce = await getNonce(transaction.sender)

	// 2. Murni — susun transaksi (belum di-sign)
	const built = createUnsignedTransaction(transaction, nonce)
	if (!built.status || !built.tx) {
		if (built.error) console.log(built.error)
		return {
			status: false,
			txHash: undefined,
			base64Data: undefined,
			rawData: undefined,
		}
	}

	// 3. KHUSUS Node/CLI — private key diambil dari file wallet di disk.
	//    Jalur browser tidak melewati baris ini (lihat catatan di atas).
	const { phrase } = loadWallet()!
	const { privateKey } = generateKeysFromMnemonic(phrase)

	// 4. Murni — tanda tangani
	const completedTx = signTransaction(built.tx, privateKey)

	logToConsole('Encoding transaction...')
	// 5. Murni — encode
	const base64Data = encodeTx(completedTx)

	return {
		status: true,
		txHash: completedTx.txHash,
		base64Data,
		rawData: completedTx,
	}
}
