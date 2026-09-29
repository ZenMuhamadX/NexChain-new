import { ec as EC } from 'elliptic'
import { hashMessage } from './hashMessage'
import { encodeV } from './chainId'

const ec = new EC('secp256k1')

// Fungsi untuk membuat signature
export const createSignature = (
	data: string,
	privateKey: string,
): { v: number; r: string; s: string } => {
	// Normalisasi prefix "Nx" (format keluaran generateKeysFromMnemonic).
	// elliptic/BN mem-parse string berprefix "Nx"+hex TANPA error tapi
	// menghasilkan key yang BERBEDA — signature jadi dibuat dengan kunci
	// salah sehingga tidak pernah cocok dengan address wallet (bug pada
	// jalur signing blok; jalur transaksi sudah dinormalisasi di
	// signTransaction). Bukti empiris: elliptic TIDAK melempar error untuk
	// input berprefix — ia diam-diam menghasilkan key publik yang berbeda
	// dari key hex murni, sehingga hasil recover tidak pernah cocok dengan
	// address wallet.
	const normalizedKey = privateKey.trim().replace(/^Nx/i, '')
	const dataHash = hashMessage(data)

	// Mendapatkan pasangan kunci
	const keyPair = ec.keyFromPrivate(normalizedKey, 'hex')

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
