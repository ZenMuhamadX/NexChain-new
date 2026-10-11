/**
 * Skema wire transaksi NexChain — pemetaan `TxInterface` ke list RLP.
 *
 * Ini DEFINISI KONTRAK antara wallet (yang meng-encode) dan node (yang
 * meng-decode). Keduanya memakai file ini, sehingga tidak mungkin berbeda
 * pendapat soal urutan field.
 *
 * Bentuk payload (tipe `0x02`, pola EIP-2718):
 *
 *     unsigned = [ chainId, nonce, fee, sender, receiver, amount, data ]
 *     sighash  = sha256(rlp(unsigned))                    ← yang di-sign
 *     signed   = [ nonce, fee, sender, receiver, amount, data, v, r, s ]
 *     payload  = 0x02 ‖ rlp(signed)
 *     txHash   = sha256(payload)                          ← identitas
 *
 * DUA hash, bukan satu. Sebelumnya `txHash` merangkap dua peran sekaligus:
 * yang ditandatangani DAN identitasnya. Pemisahan inilah yang membuat
 * `txHash` benar-benar mengikat byte yang dikirim:
 *
 *   - `sighash` ditandatangani, dihitung dari field TANPA `v/r/s` (kalau r/s
 *     ikut, terjadi siklus: tanda tangan atas dirinya sendiri).
 *   - `txHash` dihitung dari payload LENGKAP, jadi berubah bila satu bit pun
 *     berubah di wire.
 *
 * `chainId` ada di daftar unsigned (gaya EIP-155) sehingga tanda tangan
 * terikat jaringan. `v` tetap memakai encoding EIP-155
 * (`recoveryParam + chainId*2 + 35`).
 *
 * `sender` masih IKUT dikirim. Penghapusannya (pemulihan lewat `ecrecover`)
 * ditunda ke Fase 4; kini terbuka karena coinbase sudah keluar dari daftar
 * transaksi, sehingga tidak ada lagi transaksi tanpa tanda tangan.
 *
 * `format`, `timestamp`, `hexInput`, dan seluruh state siklus hidup
 * (`status`/`isValid`/`isPending`) TIDAK lagi menjadi bagian transaksi
 * maupun wire.
 */

import { TxInterface } from 'src/types/transaction'
import { HexString } from 'src/types/block'
import { CHAIN_ID } from 'src/crypto/chainId'
import { sha256 } from 'src/core/encoding/sha256'
import { rlpEncode, type RlpInput } from './rlpEncode'
import { rlpDecode } from './rlpDecode'

/** Byte tipe transaksi (EIP-2718). `0x01` = skema RLP lama. */
export const TX_TYPE = 0x02

/** Panjang list yang valid — bagian dari kontrak, bukan angka bebas. */
export const UNSIGNED_ITEM_COUNT = 7
export const SIGNED_ITEM_COUNT = 9

/** Prefix alamat yang dikenal. Indeks array = tag byte di payload. */
const ADDRESS_PREFIXES = ['NxC', 'NxS'] as const

const ADDRESS_PREFIX_LENGTH = 3
const ADDRESS_HEX_LENGTH = 40
const ADDRESS_BYTES = 1 + ADDRESS_HEX_LENGTH / 2 // tag + 20 byte

const SIGNATURE_BYTES = 32

const LOWERCASE_HEX = /^[0-9a-f]+$/

/** Prefix `txHash`. Murni tampilan — tidak ikut di-hash. */
export const TX_HASH_PREFIX = 'TxC'

// ---------------------------------------------------------------------------
// Helper byte <-> teks
// ---------------------------------------------------------------------------

const hexToBytes = (hex: string): Uint8Array => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex
	const out = new Uint8Array(clean.length >> 1)
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

const bytesToHex = (bytes: Uint8Array): string => {
	let out = ''
	for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
	return out
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
const addressToBytes = (address: string): Uint8Array => {
	if (typeof address !== 'string') {
		throw new Error('txCodec: alamat harus berupa string')
	}
	const tag = ADDRESS_PREFIXES.findIndex((prefix) =>
		address.startsWith(prefix),
	)
	if (tag < 0) {
		throw new Error(`txCodec: prefix alamat tidak dikenal: ${address}`)
	}
	const hex = address.slice(ADDRESS_PREFIX_LENGTH)
	if (hex.length !== ADDRESS_HEX_LENGTH || !LOWERCASE_HEX.test(hex)) {
		throw new Error(
			`txCodec: alamat harus ${ADDRESS_PREFIX_LENGTH + ADDRESS_HEX_LENGTH} karakter hex huruf kecil: ${address}`,
		)
	}
	const out = new Uint8Array(ADDRESS_BYTES)
	out[0] = tag
	out.set(hexToBytes(hex), 1)
	return out
}

const bytesToAddress = (bytes: Uint8Array): string => {
	if (bytes.length !== ADDRESS_BYTES) {
		throw new Error(
			`txCodec: alamat biner harus ${ADDRESS_BYTES} byte, dapat ${bytes.length}`,
		)
	}
	const prefix = ADDRESS_PREFIXES[bytes[0]]
	if (prefix === undefined) {
		throw new Error(`txCodec: tag alamat tidak dikenal: ${bytes[0]}`)
	}
	return prefix + bytesToHex(bytes.subarray(1))
}

// ---------------------------------------------------------------------------
// Bilangan bulat big-endian minimal
// ---------------------------------------------------------------------------

const numberToBytes = (value: number, field: string): Uint8Array => {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(
			`txCodec: ${field} harus bilangan bulat aman >= 0, dapat ${value}`,
		)
	}
	// Nol direpresentasikan byte string kosong (aturan RLP/Ethereum).
	if (value === 0) return new Uint8Array(0)

	const out: number[] = []
	let remaining = value
	while (remaining > 0) {
		out.unshift(remaining % 256)
		remaining = Math.floor(remaining / 256)
	}
	return new Uint8Array(out)
}

const bytesToNumber = (bytes: Uint8Array, field: string): number => {
	if (bytes.length > 0 && bytes[0] === 0) {
		throw new Error(`txCodec: ${field} tidak kanonik (byte nol di depan)`)
	}
	let value = 0
	for (const byte of bytes) value = value * 256 + byte
	if (!Number.isSafeInteger(value)) {
		throw new Error(`txCodec: ${field} melewati batas bilangan bulat aman`)
	}
	return value
}

// ---------------------------------------------------------------------------
// Data & tanda tangan
// ---------------------------------------------------------------------------

/** `data` kosong/tidak ada → byte string kosong (0x80 di RLP). */
const dataToBytes = (data: HexString | undefined): Uint8Array => {
	if (data === undefined) return new Uint8Array(0)
	const clean = data.startsWith('0x') ? data.slice(2) : data
	if (clean.length === 0) return new Uint8Array(0)
	if (clean.length % 2 !== 0 || !LOWERCASE_HEX.test(clean)) {
		throw new Error('txCodec: data harus hex huruf kecil panjang genap')
	}
	return hexToBytes(clean)
}

const bytesToData = (bytes: Uint8Array): HexString | undefined =>
	bytes.length === 0 ? undefined : (`0x${bytesToHex(bytes)}` as HexString)

const signatureHexToBytes = (hex: string, field: string): Uint8Array => {
	if (typeof hex !== 'string' || hex.length !== SIGNATURE_BYTES * 2) {
		throw new Error(
			`txCodec: ${field} harus ${SIGNATURE_BYTES * 2} karakter hex`,
		)
	}
	if (!LOWERCASE_HEX.test(hex)) {
		throw new Error(`txCodec: ${field} harus hex huruf kecil`)
	}
	return hexToBytes(hex)
}

const signatureBytesToHex = (bytes: Uint8Array, field: string): string => {
	if (bytes.length !== SIGNATURE_BYTES) {
		throw new Error(
			`txCodec: ${field} harus ${SIGNATURE_BYTES} byte, dapat ${bytes.length}`,
		)
	}
	return bytesToHex(bytes)
}

// ---------------------------------------------------------------------------
// List RLP
// ---------------------------------------------------------------------------

/** List yang DITANDATANGANI: field tanpa `v/r/s`, plus `chainId`. */
export const txUnsignedRlpList = (tx: TxInterface): RlpInput[] => [
	numberToBytes(CHAIN_ID, 'chainId'),
	numberToBytes(tx.nonce, 'nonce'),
	numberToBytes(tx.fee, 'fee'),
	addressToBytes(tx.sender),
	addressToBytes(tx.receiver),
	numberToBytes(tx.amount, 'amount'),
	dataToBytes(tx.data),
]

/** List yang DIKIRIM: field ditambah `v/r/s`. */
export const txToRlpList = (tx: TxInterface): RlpInput[] => {
	if (!tx.sign) throw new Error('txCodec: transaksi belum ditandatangani')
	return [
		numberToBytes(tx.nonce, 'nonce'),
		numberToBytes(tx.fee, 'fee'),
		addressToBytes(tx.sender),
		addressToBytes(tx.receiver),
		numberToBytes(tx.amount, 'amount'),
		dataToBytes(tx.data),
		numberToBytes(tx.sign.v, 'v'),
		signatureHexToBytes(tx.sign.r, 'r'),
		signatureHexToBytes(tx.sign.s, 's'),
	]
}

/** Kebalikan `txToRlpList`. `txHash` diisi `decodeTxPayload`, bukan di sini. */
export const rlpListToTx = (list: RlpInput): TxInterface => {
	if (!Array.isArray(list) || list.length !== SIGNED_ITEM_COUNT) {
		const got = Array.isArray(list) ? `${list.length} item` : typeof list
		throw new Error(
			`txCodec: list RLP harus ${SIGNED_ITEM_COUNT} item, dapat ${got}`,
		)
	}

	const item = (index: number, field: string): Uint8Array => {
		const value = list[index]
		if (!(value instanceof Uint8Array)) {
			throw new Error(`txCodec: item ${index} (${field}) harus byte string`)
		}
		return value
	}

	const data = bytesToData(item(5, 'data'))

	return {
		nonce: bytesToNumber(item(0, 'nonce'), 'nonce'),
		fee: bytesToNumber(item(1, 'fee'), 'fee'),
		sender: bytesToAddress(item(2, 'sender')),
		receiver: bytesToAddress(item(3, 'receiver')),
		amount: bytesToNumber(item(4, 'amount'), 'amount'),
		// Sebar bersyarat: `exactOptionalPropertyTypes` menolak `data:
		// undefined` eksplisit, dan menyebar `{}` menjaga `data` tetap absen.
		...(data === undefined ? {} : { data }),
		sign: {
			v: bytesToNumber(item(6, 'v'), 'v'),
			r: signatureBytesToHex(item(7, 'r'), 'r'),
			s: signatureBytesToHex(item(8, 's'), 's'),
		},
	}
}

// ---------------------------------------------------------------------------
// Hash & payload
// ---------------------------------------------------------------------------

/** Hash yang DITANDATANGANI — 32 byte. */
export const txSighash = (tx: TxInterface): Uint8Array =>
	sha256(rlpEncode(txUnsignedRlpList(tx)), 'buffer') as Uint8Array

/** Payload wire: `0x02 ‖ rlp(signed)`. */
export const encodeTxPayload = (tx: TxInterface): Uint8Array => {
	const body = rlpEncode(txToRlpList(tx))
	const out = new Uint8Array(body.length + 1)
	out[0] = TX_TYPE
	out.set(body, 1)
	return out
}

/** Identitas transaksi: hash dari byte yang benar-benar dikirim. */
export const txHashOfPayload = (payload: Uint8Array): string =>
	TX_HASH_PREFIX + (sha256(payload, 'hex') as string)

/** `txHash` sebuah transaksi — encode lalu hash payload-nya. */
export const txHashOf = (tx: TxInterface): string =>
	txHashOfPayload(encodeTxPayload(tx))

/** Byte payload → transaksi, lengkap dengan `txHash` hasil hash byte itu. */
export const decodeTxPayload = (data: Uint8Array): TxInterface => {
	if (data.length === 0) throw new Error('txCodec: payload kosong')
	if (data[0] !== TX_TYPE) {
		throw new Error(
			`txCodec: tipe transaksi tidak dikenal: 0x${data[0]
				.toString(16)
				.padStart(2, '0')}`,
		)
	}
	return {
		...rlpListToTx(rlpDecode(data.subarray(1))),
		txHash: txHashOfPayload(data),
	}
}
