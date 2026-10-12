import { ec as EC } from 'elliptic'
import { decodeV } from './chainId'

const ec = new EC('secp256k1')

export interface sign {
	v: number
	r: string
	s: string
}

/**
 * Pulihkan public key dari `(sighash, v, r, s)`.
 *
 * Menerima sighash 32 byte yang sudah dihitung — bukan string yang di-hash
 * lagi di sini.
 */
export const recoverPublicKey = (
	sighash: Uint8Array,
	sign: sign,
): { publicKey: string } => {
	if (!(sighash instanceof Uint8Array) || sighash.length !== 32) {
		throw new Error('recoverPublicKey: sighash harus 32 byte')
	}

	// EIP-155: decode v (87/88) ke recovery param (0/1)
	const recoveryParam = decodeV(sign.v)

	const publicKey = ec
		.recoverPubKey(sighash, { r: sign.r, s: sign.s }, recoveryParam)
		.encode('hex', true)

	return { publicKey }
}
