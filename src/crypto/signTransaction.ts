import { createSignature } from 'src/crypto/createSignature'
import { createTxnHash } from 'src/core/transaction/createTransactionHash'
import { TxInterface } from 'src/types/transaction'

/** 64 digit hex (32 byte). Prefix `Nx` opsional diterima untuk kenyamanan. */
const HEX64 = /^(?:Nx)?[0-9a-fA-F]{64}$/

/**
 * Tanda tangani transaksi — **fungsi murni**.
 *
 * Mengembalikan objek BARU (tidak memutasi input), jadi aman dipakai untuk
 * menandatangani ulang / mencoba ulang tanpa merusak draft aslinya.
 *
 * `privateKey` menerima 64 hex dengan atau tanpa prefix `Nx` (format yang
 * dikembalikan `generateKeysFromMnemonic`), sehingga pemanggil tidak perlu
 * mengingat untuk meng-`slice(2)` — salah sumber bug yang cukup umum.
 *
 * Private key TIDAK pernah menyentuh jaringan; hanya keluar sebagai bagian
 * dari signature `{ v, r, s }`.
 */
export const signTransaction = (
	transaction: TxInterface,
	privateKey: string,
): TxInterface => {
	if (typeof privateKey !== 'string' || !HEX64.test(privateKey.trim())) {
		throw new Error(
			'signTransaction: private key harus 32 byte hex (64 digit), opsional dengan prefix Nx',
		)
	}

	const normalizedKey = privateKey.trim().replace(/^Nx/i, '')

	// `txHash` wajib sudah ada sebelum menandatangani; kalau belum, hitung di sini
	// (konsisten dengan `createUnsignedTransaction`).
	const txHash = transaction.txHash ?? createTxnHash(transaction)

	return {
		...transaction,
		txHash,
		sign: createSignature(txHash, normalizedKey),
	}
}
