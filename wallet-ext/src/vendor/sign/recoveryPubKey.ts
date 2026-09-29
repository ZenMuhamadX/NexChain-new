import { ec as EC } from 'elliptic'
import { hashMessage } from './hashMessage'
import { decodeV } from './chainId'

const ec = new EC('secp256k1')

export interface sign {
	v: number
	r: string
	s: string
}

// Fungsi untuk memulihkan public key dari data, v, r, dan s
export const recoverPublicKey = (
	data: string,
	sign: sign,
): { publicKey: string } => {
	const dataHash = hashMessage(data)

	// EIP-155: decode v (87/88) ke recovery param (0/1)
	const recoveryParam = decodeV(sign.v)

	// Memulihkan public key
	const signature = { r: sign.r, s: sign.s }
	const publicKey = ec
		.recoverPubKey(dataHash, signature, recoveryParam)
		.encode('hex', true)

	return { publicKey }
}
