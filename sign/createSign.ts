import { ec as EC } from 'elliptic'
import { hashMessage } from './hashMessage'
import { encodeV } from './chainId'

const ec = new EC('secp256k1')

// Fungsi untuk membuat signature
export const createSignature = (
	data: string,
	privateKey: string,
): { v: number; r: string; s: string } => {
	const dataHash = hashMessage(data)

	// Mendapatkan pasangan kunci
	const keyPair = ec.keyFromPrivate(privateKey, 'hex')

	// Membuat signature
	const signature = keyPair.sign(dataHash)

	// Mendapatkan nilai r, s, dan v dari signature
	const r = signature.r.toString('hex')
	const s = signature.s.toString('hex')
	const recoveryParam = signature.recoveryParam! // Nilai ini adalah 0 atau 1

	// EIP-155: v = recoveryParam + chainId * 2 + 35 (replay protection)
	const v = encodeV(recoveryParam)

	// Mengembalikan hasil tanda tangan
	return {
		v,
		r: r,
		s: s,
	}
}
