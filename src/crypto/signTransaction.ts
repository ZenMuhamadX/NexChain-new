import { createSignature } from 'src/crypto/createSignature'
import { recoverSignerAddress } from 'src/crypto/verifySignature'
import { txSighash, txHashOf } from 'src/core/encoding/rlp/txCodec'
import { TxInterface } from 'src/types/transaction'

/** 64 digit hex (32 byte). Prefix `Nx` opsional diterima untuk kenyamanan. */
const HEX64 = /^(?:Nx)?[0-9a-fA-F]{64}$/

/**
 * Tanda tangani transaksi — **fungsi murni**.
 *
 * Alur:
 *
 *   1. `sighash = sha256(rlp(field unsigned))`  ← yang benar-benar di-sign
 *   2. `sign    = ECDSA(sighash)`               → { v, r, s }
 *   3. `from    = ecrecover(sighash, v, r, s)`  ← pengirim, DARI tanda tangan
 *   4. `txHash  = sha256(payload bertipe)`      ← dihitung SETELAH signing
 *
 * Langkah 3 penting untuk keseragaman: pengirim dihitung dengan cara yang
 * PERSIS SAMA seperti yang dipakai node saat `decodeTxPayload`. Karena
 * keduanya memulihkan dari tanda tangan yang sama, nilai `from` di client dan
 * di node tidak mungkin berbeda. Transaksi tidak lagi membawa klaim pengirim
 * yang harus dicocokkan.
 *
 * Urutannya juga penting: `txHash` adalah hash dari byte tertandatangani, jadi
 * ia baru bisa dihitung setelah langkah 2. Sebelumnya satu nilai merangkap dua
 * peran — yang ditandatangani sekaligus identitas — sehingga `txHash` tidak
 * pernah mengikat bentuk terenkodenya.
 *
 * Mengembalikan objek BARU (tidak memutasi input), jadi aman dipakai untuk
 * menandatangani ulang / mencoba ulang tanpa merusak draft aslinya.
 *
 * `privateKey` menerima 64 hex dengan atau tanpa prefix `Nx` (format yang
 * dikembalikan `generateKeysFromMnemonic`).
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

	const sighash = txSighash(transaction)
	const sign = createSignature(sighash, normalizedKey)
	const from = recoverSignerAddress(sighash, sign)

	const signed: TxInterface = { ...transaction, sign }

	return {
		...signed,
		// Sebar bersyarat demi `exactOptionalPropertyTypes`. Dalam praktiknya
		// `from` selalu terisi di sini — tanda tangannya baru saja dibuat.
		...(from === undefined ? {} : { from }),
		txHash: txHashOf(signed),
	}
}
