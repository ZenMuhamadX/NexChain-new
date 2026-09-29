import { ec as EC } from 'elliptic'
import type { TinySecp256k1Interface } from 'bip32'
import { hexToBytes } from 'nexchain/block/sha256'

/**
 * Adapter secp256k1 berbasis `elliptic` (murni JS) untuk BIP32.
 *
 * MENGAPA TIDAK PAKAI `tiny-secp256k1`?
 *   Versi browser-nya memuat WebAssembly dengan gaya webpack:
 *       import * as wasm from "./secp256k1.wasm"
 *   Vite/esbuild tidak mengerti bentuk itu, sehingga bundling untuk browser
 *   GAGAL ("No loader is configured for .wasm files").
 *
 * CARA KERJANYA:
 *   `bip32` sengaja menerima ecc lewat parameter -> `BIP32Factory(ecc)`,
 *   jadi kita bisa menukar implementasi tanpa menyentuh logika turunan kunci.
 *   Turunan kunci TIDAK berubah selama fungsi-fungsi di bawah menghasilkan
 *   nilai yang sama dengan tiny-secp256k1.
 *
 * VERIFIKASI:
 *   1. `testEcc(ecc)` bawaan bip32 otomatis dijalankan oleh BIP32Factory()
 *      (memeriksa isPoint/isPrivate/pointFromScalar/pointAddScalar/privateAdd/
 *       sign/verify terhadap test-vector).
 *   2. Perbandingan byte-to-byte hasil derivePath terhadap tiny-secp256k1.
 *
 * Catatan implementasi: bn.js mengabaikan `base` untuk input array dan selalu
 * memakai endian big-endian, sehingga byte array diterima elliptic sebagai
 * bilangan BE (sama seperti implementasi standar).
 */
const ec = new EC('secp256k1')

/** Ordo kurva secp256k1 n. */
const N_HEX = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
const ZERO_HEX = '0'.repeat(64)

/** Byte array / number[] -> hex string (2 digit per byte). */
const bytesToHex = (bytes: ArrayLike<number>): string => {
	let out = ''
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i].toString(16).padStart(2, '0')
	}
	return out
}

/** BigInt dari byte array (big-endian). */
const bytesToBig = (bytes: ArrayLike<number>): bigint =>
	BigInt('0x' + bytesToHex(bytes))

/**
 * 0 < d < n ?
 * Dipakai untuk menolak skalar di luar rentang valid secp256k1.
 */
const isPrivateHex = (hex: string): boolean =>
	hex !== ZERO_HEX && hex.length === 64 && hex < N_HEX

/**
 * Apakah `p` adalah titik kurva secp256k1 yang valid.
 *
 * Selain memastikan panjang + prefix byte, hasil decode di-encode ulang lalu
 * dibandingkan byte-nya. Ini menolak titik yang bukan anggota kurva
 * (mis. 030000...05) yang kadang tetap "berhasil" di-decode.
 */
const isPoint = (p: Uint8Array): boolean => {
	try {
		const hex = bytesToHex(p)
		let compressed = false

		// Cek prefix byte (p[0]), BUKAN hex[0] - hex bisa diawali '0'
		if (p.length === 33) {
			if (p[0] !== 2 && p[0] !== 3) return false
			compressed = true
		} else if (p.length === 65) {
			if (p[0] !== 4) return false
		} else {
			return false
		}

		const point = ec.curve.decodePoint(hex, 'hex')
		if (point.isInfinity()) return false
		return bytesToHex(point.encode('array', compressed)) === hex
	} catch {
		return false
	}
}

/** Skalar privat valid -> publik point (compressed 33 byte / uncompressed 65). */
const pointFromScalar = (
	d: Uint8Array,
	compressed = true,
): Uint8Array | null => {
	const hex = bytesToHex(d)
	if (!isPrivateHex(hex)) return null
	return hexToBytes(
		bytesToHex(ec.keyFromPrivate(hex).getPublic().encode('array', compressed)),
	)
}

/**
 * P + (G * tweak) — dipakai bip32 untuk turunan publik non-hardened.
 * Mengembalikan null bila hasilnya identitas (infinity) atau input tak valid.
 */
const pointAddScalar = (
	p: Uint8Array,
	tweak: Uint8Array,
	compressed = true,
): Uint8Array | null => {
	try {
		const tweakHex = bytesToHex(tweak)
		if (!isPrivateHex(tweakHex)) return null

		const point = ec.curve.decodePoint(bytesToHex(p), 'hex')
		const tweaked = point.add(ec.g.mul(tweakHex))
		if (tweaked.isInfinity()) return null
		return hexToBytes(bytesToHex(tweaked.encode('array', compressed)))
	} catch {
		return null
	}
}

/**
 * (d + tweak) mod n — inti turunan kunci privat BIP32.
 *
 * Mengikuti BIP32: ki = parse256(IL) + kpar (mod n), jadi bila jumlahnya
 * melebihi n HARUS dibulatkan modulo n, bukan dianggap gagal. Kegagalan hanya
 * terjadi bila salah satu input >= n, atau hasilnya nol.
 *
 * (Sebelumnya saya salah mengembalikan null saat sum >= n; akibatnya bip32
 * memanggil derive(index + 1) dan seluruh turunan kunci bergeser.)
 */
const privateAdd = (d: Uint8Array, tweak: Uint8Array): Uint8Array | null => {
	const n = BigInt('0x' + N_HEX)
	const a = bytesToBig(d)
	const t = bytesToBig(tweak)

	if (a >= n || t >= n) return null

	const sum = a + t
	const reduced = sum >= n ? sum - n : sum // (a + t) mod n, dgn a,t < n
	if (reduced === 0n) return null

	return hexToBytes(reduced.toString(16).padStart(64, '0'))
}

/**
 * ECDSA (RFC6979, low-S / canonical) -> 64 byte r || s.
 * `e` (extra entropy) tidak dipakai: bip32 tidak pernah mengirimkannya.
 */
const sign = (h: Uint8Array, d: Uint8Array, _e?: Uint8Array): Uint8Array => {
	const sig = ec.keyFromPrivate(bytesToHex(d)).sign(h, { canonical: true })
	const r = bytesToHex(sig.r.toArray('be', 32))
	const s = bytesToHex(sig.s.toArray('be', 32))
	return hexToBytes(r + s)
}

/** Verifikasi ECDSA 64 byte r || s terhadap publik key. */
const verify = (
	h: Uint8Array,
	Q: Uint8Array,
	signature: Uint8Array,
	_utf8Strict?: boolean,
): boolean => {
	if (signature.length !== 64) return false
	try {
		const r = bytesToHex(signature.slice(0, 32))
		const s = bytesToHex(signature.slice(32, 64))
		// keyFromPublic menerima Uint8Array; tanpa `enc`, elliptic menyalin
		// byte apa adanya (utils.toArray menyalin utk input non-string).
		const key = ec.keyFromPublic(Q)
		return ec.verify(h, { r, s }, key)
	} catch {
		return false
	}
}

/**
 * Ecc secp256k1 siap pakai untuk `BIP32Factory(ecc)`.
 * Fungsi opsional yang tidak dipakai derivePath (signSchnorr, verifySchnorr,
 * xOnlyPointAddTweak, privateNegate) sengaja tidak diimplementasikan.
 */
export const ecc: TinySecp256k1Interface = {
	isPoint,
	isPrivate: (d: Uint8Array): boolean => isPrivateHex(bytesToHex(d)),
	pointFromScalar,
	pointAddScalar,
	privateAdd,
	sign,
	verify,
}
