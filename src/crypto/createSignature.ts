import { ec as EC } from 'elliptic'
import { encodeV } from './chainId'

const ec = new EC('secp256k1')

/**
 * Buat tanda tangan ECDSA atas sebuah **sighash** (32 byte).
 *
 * Menerima hash yang SUDAH dihitung, bukan pesan mentah. Sebelumnya fungsi
 * ini menerima string lalu meng-hash-nya sendiri lewat `hashMessage`, dan
 * pemanggilnya menyerahkan `txHash` (sebuah string hex) — sehingga terjadi
 * hash GANDA: `sha256(string hex dari sha256(...))`. Sekarang preimage-nya
 * byte RLP yang di-hash tepat sekali.
 *
 * @param sighash 32 byte hasil `sha256(rlp(field unsigned))`
 */
export const createSignature = (
	sighash: Uint8Array,
	privateKey: string,
): { v: number; r: string; s: string } => {
	if (!(sighash instanceof Uint8Array) || sighash.length !== 32) {
		throw new Error('createSignature: sighash harus 32 byte')
	}

	// Normalisasi prefix "Nx" (format keluaran generateKeysFromMnemonic).
	// elliptic/BN mem-parse string berprefix "Nx"+hex TANPA error tapi
	// menghasilkan key yang BERBEDA — signature jadi dibuat dengan kunci
	// salah sehingga tidak pernah cocok dengan address wallet.
	const normalizedKey = privateKey.trim().replace(/^Nx/i, '')
	const keyPair = ec.keyFromPrivate(normalizedKey, 'hex')

	// `canonical: true` memaksa `s` ke bentuk low-s (s <= n/2). Tanpa opsi
	// ini elliptic membiarkan `s` melewati n/2, sehingga tanda tangan menjadi
	// MALLEABLE: pihak ketiga bisa mengganti `s` dengan `n - s` dan hasilnya
	// tetap valid untuk pengirim yang sama. Karena `txHash` kini adalah hash
	// dari byte tertandatangani, malleability akan menghasilkan DUA txHash
	// untuk satu transaksi logis — Ethereum mewajibkan low-s (EIP-2) karena
	// alasan yang sama.
	const signature = keyPair.sign(sighash, { canonical: true })

	// r/s di-PAD ke 32 byte (64 hex). `BN.toString('hex')` memangkas byte nol
	// di depan, sehingga panjangnya bisa kurang dari 64 dan tidak bisa ditulis
	// sebagai 32 byte tetap di RLP. Padding netral secara kriptografi: nol di
	// depan tidak mengubah nilai, dan elliptic mem-parse r/s lewat BN.
	const r = signature.r.toString('hex').padStart(64, '0')
	const s = signature.s.toString('hex').padStart(64, '0')

	// EIP-155: v = recoveryParam + chainId * 2 + 35 (replay protection)
	const v = encodeV(signature.recoveryParam!)

	return { v, r, s }
}
