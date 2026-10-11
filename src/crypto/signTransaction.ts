import { createSignature } from 'src/crypto/createSignature'
import { txSighash, txHashOf } from 'src/core/encoding/rlp/txCodec'
import { TxInterface } from 'src/types/transaction'

/** 64 digit hex (32 byte). Prefix `Nx` opsional diterima untuk kenyamanan. */
const HEX64 = /^(?:Nx)?[0-9a-fA-F]{64}$/

/**
 * Tanda tangani transaksi — **fungsi murni**.
 *
 * Alur (dua hash, bukan satu):
 *
 *   1. `sighash = sha256(rlp(field unsigned))`  ← yang benar-benar di-sign
 *   2. `sign    = ECDSA(sighash)`               → { v, r, s }
 *   3. `txHash  = sha256(payload bertipe)`      ← dihitung SETELAH signing
 *
 * Urutannya penting: `txHash` adalah hash dari byte tertandatangani, jadi ia
 * baru bisa dihitung setelah langkah 2. Sebelumnya satu nilai merangkap dua
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

	const sign = createSignature(txSighash(transaction), normalizedKey)
	const signed: TxInterface = { ...transaction, sign }

	return { ...signed, txHash: txHashOf(signed) }
}
