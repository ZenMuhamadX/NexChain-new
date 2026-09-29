import { ec as EC } from 'elliptic'
import { recoverPublicKey, sign } from 'src/crypto/recoverPublicKey'
import { hashMessage } from './hashMessage'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'

const ec = new EC('secp256k1')

/**
 * Recover PUBLIC KEY asli dari signature, lalu verifikasi ECDSA-nya.
 *
 * Penting: recoverPubKey pada signature apapun SELALU menghasilkan sebuah
 * public key yang "valid" untuk hash tersebut. Karena itu verifikasi HARUS
 * dilakukan dengan membandingkan address hasil recover terhadap address
 * pengirim — bukan hanya memverifikasi terhadap key hasil recover itu sendiri
 * (itu siklus tertutup dan selalu true / bisa dipalsukan).
 *
 * @returns address pemilik key yang benar-benar menandatangani, atau undefined jika invalid
 */
export const recoverSignerAddress = (
	data: string,
	sign: sign,
): string | undefined => {
	try {
		const dataHash = hashMessage(data)

		// recoverPublicKey butuh v (untuk recoveryParam) dan r,s
		const { publicKey } = recoverPublicKey(data, sign)

		const keyPair = ec.keyFromPublic(publicKey, 'hex')
		if (!keyPair.verify(dataHash, { r: sign.r, s: sign.s })) return undefined

		return generateAddressFromPublicKey(publicKey)
	} catch {
		return undefined
	}
}

/**
 * Verifikasi signature.
 *
 * @param data          data yang di-hash (txHash / block hash)
 * @param sign          signature { v, r, s }
 * @param expectedAddress jika diisi, address hasil recover WAJIB sama dengan ini.
 *                        Tanpa param ini verifikasi tidak bermakna (lihat catatan di atas).
 */
export const verifySignature = (
	data: string,
	sign: sign,
	expectedAddress?: string,
): boolean => {
	const signer = recoverSignerAddress(data, sign)
	if (signer === undefined) return false
	if (expectedAddress !== undefined && signer !== expectedAddress) return false
	return true
}
