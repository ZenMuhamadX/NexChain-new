import { TxInterface } from 'interface/structTx'
import { isContract } from 'nexchain/lib/isContract'

export interface TxRoles {
	isSenderContract: boolean
	isReceiverContract: boolean
}

/**
 * Tentukan peran (kontrak vs EOA) sebuah transaksi DARI ALAMAT, bukan dari
 * flag yang dibawa transaksi.
 *
 * BUG-E3: sebelumnya `processTransact` membaca `tx.isSenderContract` /
 * `tx.isReceiverContract` yang dikirim client untuk memilih cabang akuntansi.
 * Kedua field itu TIDAK ikut di-hash oleh `createTxnHash` (yang hanya mencakup
 * sender, receiver, amount, extraMessage, timestamp, format, fee, nonce), jadi
 * penanderang bisa membaliknya SETELAH menandatangani tanpa merusak signature.
 *
 * Akibatnya penyerang memilih sendiri jalur pemrosesan:
 *   - transfer ke kontrak dijalankan sebagai transfer EOA -> kredit masuk ke
 *     catatan saldo alamat kontrak, bukan field `balance` kontrak -> saldo
 *     terpecah dan tak terlihat oleh logika kontrak;
 *   - kebalikannya -> debit tidak menguruti saldo kontrak yang benar, sehingga
 *     bisa mencetak saldo baru.
 *
 * Aturan: peran SELALU diturunkan dari alamat. `isContract()` = prefix "NxS".
 * Flag pada `TxInterface` tetap ada untuk penyimpanan/tampilan, tapi tidak
 * pernah lagi dipercaya untuk mengambil keputusan.
 */
export const resolveTxRoles = (tx: TxInterface): TxRoles => ({
	isSenderContract: isContract(tx.sender),
	isReceiverContract: isContract(tx.receiver),
})
