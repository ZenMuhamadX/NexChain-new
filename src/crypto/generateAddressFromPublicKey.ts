import { ec as EC } from 'elliptic'
import { keccak256 } from 'src/core/encoding/keccak256'
import { hexToBytes } from 'src/core/encoding/sha256'

const ec = new EC('secp256k1')

/**
 * Generate wallet address dari public key.
 *
 * Sama seperti MetaMask: keccak256 dari public key uncompressed tanpa byte
 * `0x04`, 20 byte terakhir, lalu prefix `NxC`. Public key invalid ditolak —
 * tidak ada fallback ke alamat lain.
 */
export const generateAddressFromPublicKey = (publicKey: string): string => {
	let uncompressed: string
	try {
		uncompressed = ec
			.keyFromPublic(publicKey, 'hex')
			.getPublic(false, 'hex')
			.slice(2)
	} catch {
		throw new Error('Invalid public key for address generation')
	}

	return `NxC${keccak256(hexToBytes(uncompressed)).slice(-40)}`
}
