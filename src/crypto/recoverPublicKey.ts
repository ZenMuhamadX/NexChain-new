import { ec as EC } from 'elliptic'
import { decodeV } from './chainId'

const ec = new EC('secp256k1')

/** Ordo kurva secp256k1 (n). */
const SECP256K1_ORDER = BigInt(
	'0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
)

/** Batas low-S (EIP-2): `s` wajib `<= floor(n / 2)`. */
const HALF_N = SECP256K1_ORDER >> 1n

export interface sign {
	v: number
	r: string
	s: string
}

/**
 * Tolak signature dengan `s` di luar rentang kanonik secp256k1.
 *
 * Dua syarat dipenuhi bersamaan:
 *   1. `1 <= s <= n - 1` — rentang skalar ECDSA yang sah;
 *   2. `s <= n / 2`      — **low-S** (EIP-2).
 *
 * Tanpa syarat kedua setiap signature bisa "di-malleate": pihak ketiga
 * mengganti `s` dengan `n - s` (dan membalik `v`) dan hasilnya tetap valid
 * untuk pengirim yang sama. Itu menghasilkan dua signature berbeda untuk satu
 * transaksi logis → dua `txHash` untuk satu niat kirim (lihat catatan di
 * `createSignature.ts`). Sisi verifikasi juga jadi mahal: node harus
 * menerima dua bentuk untuk satu fakta yang sama.
 *
 * Pemanggil (`verifySignature`) menangkap error ini dan mengembalikan
 * `undefined` — transaksi high-S dianggap tidak sah, bukan crash.
 *
 * Murni BigInt (tanpa node built-in) — modul ini ikut ter-bundle ke UI.
 *
 * @throws Error bila `s` bukan hex valid, `< 1`, `> n - 1`, atau `> n / 2`.
 */
const assertCanonicalS = (s: string): void => {
	let value: bigint
	try {
		// `BigInt` menerima hex ganjil panjangnya ("0x1" … "0xfff") apa adanya.
		value = BigInt('0x' + s.replace(/^0x/i, ''))
	} catch {
		throw new Error(
			`recoverPublicKey: s bukan hex yang valid — signature ditolak (low-S / EIP-2)`,
		)
	}

	if (value < 1n) {
		throw new Error(
			`recoverPublicKey: s=${value} di luar rentang ECDSA (s >= 1) — signature ditolak (low-S / EIP-2)`,
		)
	}
	if (value > SECP256K1_ORDER - 1n) {
		throw new Error(
			`recoverPublicKey: s melebihi ordo kurva n-1 — signature ditolak (low-S / EIP-2)`,
		)
	}
	if (value > HALF_N) {
		throw new Error(
			`recoverPublicKey: s > n/2 (high-S) — signature ditolak (low-S / EIP-2)`,
		)
	}
}

/**
 * Pulihkan public key dari `(sighash, v, r, s)`.
 *
 * Menerima sighash 32 byte yang sudah dihitung — bukan string yang di-hash
 * lagi di sini.
 *
 * `s` divalidasi low-S SEBELUM `ec.recoverPubKey` (aturan konsensus —
 * lihat `assertCanonicalS`).
 */
export const recoverPublicKey = (
	sighash: Uint8Array,
	sign: sign,
): { publicKey: string } => {
	if (!(sighash instanceof Uint8Array) || sighash.length !== 32) {
		throw new Error('recoverPublicKey: sighash harus 32 byte')
	}

	// Aturan konsensus: tolak signature high-S (EIP-2) sebelum pemulihan.
	assertCanonicalS(sign.s)

	// EIP-155: decode v (87/88) ke recovery param (0/1)
	const recoveryParam = decodeV(sign.v)

	const publicKey = ec
		.recoverPubKey(sighash, { r: sign.r, s: sign.s }, recoveryParam)
		.encode('hex', true)

	return { publicKey }
}
