/**
 * Primitif byte <-> skalar untuk codec RLP NexChain.
 *
 * Dipisahkan dari `txCodec.ts` ketika codec blok ditambahkan. Blok dan
 * transaksi memetakan jenis nilai yang SAMA (integer, hex, alamat, data) ke
 * byte string RLP; menyalin fungsi-fungsi parsing ini ke codec kedua berarti
 * dua salinan aturan validasi yang bisa menyimpang diam-diam — tepat di kode
 * yang menangani nilai uang. Karena itu aturannya hidup di satu tempat.
 *
 * `label` menandai sumber pesan galat (`txCodec` / `blockCodec`). Default
 * `txCodec` dipertahankan supaya ekstraksi ini tidak mengubah perilaku
 * (termasuk teks galat) transaksi yang sudah beredar.
 *
 * Murni: tanpa I/O dan tanpa API Node, sehingga aman di-bundle ke wallet
 * browser (dijaga `bun run check:browser`).
 */
import type { HexString } from 'src/types/block'

/** Prefix alamat yang dikenal. Indeks array = tag byte di payload. */
const ADDRESS_PREFIXES = ['NxC', 'NxS'] as const

const ADDRESS_PREFIX_LENGTH = 3
const ADDRESS_HEX_LENGTH = 40
const ADDRESS_BYTES = 1 + ADDRESS_HEX_LENGTH / 2 // tag + 20 byte

/** Hex huruf kecil. Alamat & data nyata selalu huruf kecil. */
export const LOWERCASE_HEX = /^[0-9a-f]+$/

// ---------------------------------------------------------------------------
// Helper byte <-> teks
// ---------------------------------------------------------------------------

/**
 * Hex (dengan/tanpa `0x`) → byte.
 *
 * TIDAK memvalidasi: `parseInt` yang gagal menghasilkan NaN secara senyap, dan
 * panjang ganjil membuang setengah byte terakhir. Pemanggil WAJIB memvalidasi
 * lebih dulu — lihat `dataToBytes` dan `addressToBytes`.
 */
export const hexToBytes = (hex: string): Uint8Array => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex
	const out = new Uint8Array(clean.length >> 1)
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

export const bytesToHex = (bytes: Uint8Array): string => {
	let out = ''
	for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
	return out
}

// ---------------------------------------------------------------------------
// Bilangan bulat big-endian minimal
// ---------------------------------------------------------------------------

/**
 * Integer >= 0 → byte string big-endian minimal; 0 → byte string kosong
 * (aturan RLP/Ethereum).
 *
 * Memakai `% 256` + `Math.floor(/ 256)`, BUKAN operator bitwise: `| 0`
 * memaksa int32 dan akan merusak nonce >= 2^31 secara senyap.
 */
export const numberToBytes = (
	value: number,
	field: string,
	label = 'txCodec',
): Uint8Array => {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(
			`${label}: ${field} harus bilangan bulat aman >= 0, dapat ${value}`,
		)
	}
	if (value === 0) return new Uint8Array(0)

	const out: number[] = []
	let remaining = value
	while (remaining > 0) {
		out.unshift(remaining % 256)
		remaining = Math.floor(remaining / 256)
	}
	return new Uint8Array(out)
}

export const bytesToNumber = (
	bytes: Uint8Array,
	field: string,
	label = 'txCodec',
): number => {
	if (bytes.length > 0 && bytes[0] === 0) {
		throw new Error(`${label}: ${field} tidak kanonik (byte nol di depan)`)
	}
	let value = 0
	for (const byte of bytes) value = value * 256 + byte
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${label}: ${field} melewati batas bilangan bulat aman`)
	}
	return value
}

// ---------------------------------------------------------------------------
// Alamat
// ---------------------------------------------------------------------------

/**
 * Alamat `NxC`/`NxS` + 40 hex → 1 byte tag prefix + 20 byte.
 *
 * Hanya huruf kecil yang diterima: alamat nyata selalu huruf kecil
 * (`generateAddressFromPublicKey` memakai keluaran js-sha3), dan menolak
 * bentuk lain di sini membuat kegagalan terjadi di client dengan pesan yang
 * jelas — bukan di node sebagai "signature tidak cocok".
 */
export const addressToBytes = (
	address: string,
	label = 'txCodec',
): Uint8Array => {
	if (typeof address !== 'string') {
		throw new Error(`${label}: alamat harus berupa string`)
	}
	const tag = ADDRESS_PREFIXES.findIndex((prefix) => address.startsWith(prefix))
	if (tag < 0) {
		throw new Error(`${label}: prefix alamat tidak dikenal: ${address}`)
	}
	const hex = address.slice(ADDRESS_PREFIX_LENGTH)
	if (hex.length !== ADDRESS_HEX_LENGTH || !LOWERCASE_HEX.test(hex)) {
		throw new Error(
			`${label}: alamat harus ${ADDRESS_PREFIX_LENGTH + ADDRESS_HEX_LENGTH} karakter hex huruf kecil: ${address}`,
		)
	}
	const out = new Uint8Array(ADDRESS_BYTES)
	out[0] = tag
	out.set(hexToBytes(hex), 1)
	return out
}

export const bytesToAddress = (
	bytes: Uint8Array,
	label = 'txCodec',
): string => {
	if (bytes.length !== ADDRESS_BYTES) {
		throw new Error(
			`${label}: alamat biner harus ${ADDRESS_BYTES} byte, dapat ${bytes.length}`,
		)
	}
	const prefix = ADDRESS_PREFIXES[bytes[0]]
	if (prefix === undefined) {
		throw new Error(`${label}: tag alamat tidak dikenal: ${bytes[0]}`)
	}
	return prefix + bytesToHex(bytes.subarray(1))
}

// ---------------------------------------------------------------------------
// Data arbitrer (`0x`-prefixed hex)
// ---------------------------------------------------------------------------

/** `data` kosong/tidak ada → byte string kosong (0x80 di RLP). */
export const dataToBytes = (
	data: HexString | undefined,
	label = 'txCodec',
): Uint8Array => {
	if (data === undefined) return new Uint8Array(0)
	const clean = data.startsWith('0x') ? data.slice(2) : data
	if (clean.length === 0) return new Uint8Array(0)
	if (clean.length % 2 !== 0 || !LOWERCASE_HEX.test(clean)) {
		throw new Error(`${label}: data harus hex huruf kecil panjang genap`)
	}
	return hexToBytes(clean)
}

export const bytesToData = (bytes: Uint8Array): HexString | undefined =>
	bytes.length === 0 ? undefined : (`0x${bytesToHex(bytes)}` as HexString)

// ---------------------------------------------------------------------------
// UTF-8 & float64 — ditambahkan untuk codec blok
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder()

/** String UTF-8 → byte (`version`, `status`, `hashingAlgorithm` blok). */
export const stringToBytes = (value: string): Uint8Array =>
	TEXT_ENCODER.encode(value)

/**
 * Byte → string UTF-8.
 *
 * `fatal: true` supaya byte yang bukan UTF-8 sah MELEMPAR: blok dari jaringan
 * tidak boleh di-decode menjadi teks pengganti (U+FFFD) yang lalu ikut di-hash.
 */
export const bytesToString = (
	bytes: Uint8Array,
	field: string,
	label = 'blockCodec',
): string => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		throw new Error(`${label}: ${field} bukan UTF-8 yang sah`)
	}
}

/**
 * Float → IEEE-754 float64 8 byte big-endian.
 *
 * RLP hanya mengenal byte string, sedangkan dua field blok dikirim sebagai
 * float64: `header.difficulty` (pecahan — kuantisasi 0.25 bit) dan
 * `block.size` (jumlah byte payload tx; DULU KB float dari
 * `calculateSize(...).KB`). Keduanya tetap float64 supaya wire tidak berubah
 * hanya karena arti `size` berganti. float64 mentah = round-trip eksak untuk
 * setiap f64, tanpa menafsirkan ulang arti field.
 */
export const float64ToBytes = (
	value: number,
	field: string,
	label = 'blockCodec',
): Uint8Array => {
	if (!Number.isFinite(value)) {
		throw new Error(
			`${label}: ${field} harus bilangan terbatas, dapat ${value}`,
		)
	}
	const out = new Uint8Array(8)
	new DataView(out.buffer).setFloat64(0, value, false)
	return out
}

export const bytesToFloat64 = (
	bytes: Uint8Array,
	field: string,
	label = 'blockCodec',
): number => {
	if (bytes.length !== 8) {
		throw new Error(
			`${label}: ${field} harus 8 byte float64, dapat ${bytes.length}`,
		)
	}
	// `byteOffset` diteruskan: `bytes` bisa berupa subarray dari buffer besar.
	const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(
		0,
		false,
	)
	if (!Number.isFinite(value)) {
		throw new Error(`${label}: ${field} bukan bilangan terbatas`)
	}
	return value
}
