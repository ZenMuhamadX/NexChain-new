/**
 * Skema wire transaksi NexChain — pemetaan `TxInterface` ke list RLP.
 *
 * Ini adalah DEFINISI KONTRAK antara wallet (yang meng-encode) dan node (yang
 * meng-decode). Keduanya memakai file ini, sehingga tidak mungkin berbeda
 * pendapat soal urutan field.
 *
 * Bentuk payload:
 *
 *     bytes = 0x01 ‖ rlp([ ...10 item... ])
 *     string = base64(bytes)                  ← yang lewat di params JSON-RPC
 *
 * Byte `0x01` di LUAR list mengikuti pola EIP-2718 (typed transaction):
 * tipe menyiratkan skema, sehingga versi berikutnya (`0x02`) bisa punya
 * susunan berbeda tanpa merusak yang lama. Ia juga membuat deteksi format
 * menjadi sepele — payload msgpack lama selalu mulai dengan 0xd9/0xda.
 *
 * Susunan list (posisional — urutan adalah skema):
 *
 *     0  sender        1 byte tag prefix + 20 byte
 *     1  receiver      idem
 *     2  amount        big-endian minimal
 *     3  fee           big-endian minimal
 *     4  nonce         big-endian minimal
 *     5  timestamp     big-endian minimal
 *     6  extraMessage  kosong = DEFAULT_EXTRA_MESSAGE, selain itu UTF-8
 *     7  v             big-endian minimal
 *     8  r             32 byte
 *     9  s             32 byte
 *
 * Field yang SENGAJA tidak dikirim, karena node menghitung atau menimpanya
 * sendiri:
 *
 *   - `txHash`     → dihitung ulang di sini lewat `createTxnHash`
 *   - `hexInput`   → dihitung ulang di sini lewat rumus yang sama
 *   - `status`     → node menimpa jadi 'pending' (txValidator.v.ts)
 *   - `isValid`    → node menimpa jadi true
 *   - `isPending`  → node menimpa jadi true
 *
 * Efeknya bukan sekadar hemat byte: node berhenti MEMPERCAYAI nilai turunan
 * yang dikirim client. Sebelumnya client bisa mengirim `hexInput` atau
 * `txHash` yang tidak cocok dengan isi transaksinya dan node menyimpannya
 * begitu saja.
 *
 * CATATAN PENTING: karena `status`/`isValid`/`isPending` tidak dikirim,
 * `decodeTxPayload` SELALU menghasilkan transaksi berstatus 'pending'.
 * Itu benar untuk jalur kirim (satu-satunya pemakai `encodeTx`), tetapi
 * codec ini BUKAN round-trip lossless untuk transaksi yang sudah dikonfirmasi.
 */

import { TxInterface } from 'src/types/transaction'
import { createTxnHash } from 'src/core/transaction/createTransactionHash'
import { DEFAULT_EXTRA_MESSAGE } from 'src/core/transaction/constants'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { rlpEncode, type RlpInput } from './rlpEncode'
import { rlpDecode } from './rlpDecode'

/** Byte tipe transaksi (EIP-2718 style). Versi berikutnya: 0x02, 0x03, … */
export const TX_TYPE_RLP = 0x01

/** Panjang list yang valid — bagian dari kontrak, bukan angka bebas. */
const ITEM_COUNT = 10

/** Prefix alamat yang dikenal. Indeks array = tag byte di payload. */
const ADDRESS_PREFIXES = ['NxC', 'NxS'] as const

const ADDRESS_PREFIX_LENGTH = 3
const ADDRESS_HEX_LENGTH = 40
const ADDRESS_BYTES = 1 + ADDRESS_HEX_LENGTH / 2 // tag + 20 byte

const SIGNATURE_BYTES = 32

const LOWERCASE_HEX = /^[0-9a-f]+$/

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// ---------------------------------------------------------------------------
// Helper byte <-> teks
// ---------------------------------------------------------------------------

const hexToBytes = (hex: string): Uint8Array => {
	const out = new Uint8Array(hex.length >> 1)
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
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
 * Hanya huruf kecil yang diterima. Alamat nyata selalu huruf kecil
 * (`generateAddressFromPublicKey` memakai keluaran js-sha3), dan menolak
 * bentuk lain di sini membuat kegagalan terjadi di client dengan pesan yang
 * jelas — bukan di node sebagai "signature tidak cocok" yang membingungkan.
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
	// Nol direpresentasikan sebagai byte string kosong (aturan RLP/Ethereum).
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
	// Bentuk kanonik tidak boleh punya byte nol di depan.
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
// Pesan & tanda tangan
// ---------------------------------------------------------------------------

/**
 * Pesan default TIDAK dikirim ulang — ia konstanta protokol. Mengirim string
 * 50 karakter yang sama di setiap transaksi adalah pemborosan murni, jadi
 * kasus umum diwakili byte string kosong.
 *
 * Round-trip tetap utuh: pesan kustom yang kebetulan sama persis dengan
 * default akan ter-encode sebagai kosong dan kembali menjadi default — nilai
 * yang identik.
 */
const messageToBytes = (message: string): Uint8Array =>
	message === DEFAULT_EXTRA_MESSAGE
		? new Uint8Array(0)
		: textEncoder.encode(message)

const bytesToMessage = (bytes: Uint8Array): string =>
	bytes.length === 0 ? DEFAULT_EXTRA_MESSAGE : textDecoder.decode(bytes)

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
// Transaksi <-> list RLP
// ---------------------------------------------------------------------------

/** Ubah transaksi menjadi list RLP posisional (lihat tabel di header). */
export const txToRlpList = (tx: TxInterface): RlpInput[] => {
	if (tx.format !== 'nexu') {
		throw new Error(
			`txCodec: format transaksi harus 'nexu', dapat ${tx.format}`,
		)
	}
	if (!tx.sign) {
		throw new Error('txCodec: transaksi belum ditandatangani')
	}

	return [
		addressToBytes(tx.sender),
		addressToBytes(tx.receiver),
		numberToBytes(tx.amount, 'amount'),
		numberToBytes(tx.fee, 'fee'),
		numberToBytes(tx.nonce, 'nonce'),
		numberToBytes(tx.timestamp, 'timestamp'),
		messageToBytes(tx.extraMessage ?? DEFAULT_EXTRA_MESSAGE),
		numberToBytes(tx.sign.v, 'v'),
		signatureHexToBytes(tx.sign.r, 'r'),
		signatureHexToBytes(tx.sign.s, 's'),
	]
}

/**
 * Kebalikan `txToRlpList`. Menghitung ulang `txHash` dan `hexInput` dari
 * field yang diterima, dan mengisi status node-managed dengan nilai awal.
 */
export const rlpListToTx = (list: RlpInput): TxInterface => {
	if (!Array.isArray(list) || list.length !== ITEM_COUNT) {
		const got = Array.isArray(list) ? `${list.length} item` : typeof list
		throw new Error(`txCodec: list RLP harus ${ITEM_COUNT} item, dapat ${got}`)
	}

	const item = (index: number, field: string): Uint8Array => {
		const value = list[index]
		if (!(value instanceof Uint8Array)) {
			throw new Error(`txCodec: item ${index} (${field}) harus byte string`)
		}
		return value
	}

	const sender = bytesToAddress(item(0, 'sender'))
	const receiver = bytesToAddress(item(1, 'receiver'))
	const amount = bytesToNumber(item(2, 'amount'), 'amount')
	const fee = bytesToNumber(item(3, 'fee'), 'fee')
	const nonce = bytesToNumber(item(4, 'nonce'), 'nonce')
	const timestamp = bytesToNumber(item(5, 'timestamp'), 'timestamp')
	const extraMessage = bytesToMessage(item(6, 'extraMessage'))
	const sign = {
		v: bytesToNumber(item(7, 'v'), 'v'),
		r: signatureBytesToHex(item(8, 'r'), 'r'),
		s: signatureBytesToHex(item(9, 's'), 's'),
	}

	// Urutan key di bawah HARUS sama dengan `createUnsignedTransaction`:
	// `check:tx` membandingkan lewat `JSON.stringify`, yang peka urutan.
	const base = {
		format: 'nexu' as const,
		amount,
		receiver,
		sender,
		timestamp,
		fee,
		nonce,
		isPending: true,
		isValid: false,
		extraMessage,
		status: 'pending' as const,
		sign,
	}

	const txHash = createTxnHash(base as TxInterface)
	const hexInput = stringToHex(
		JSON.stringify({ format: 'nexu', amount, receiver, sender, timestamp }),
	)

	return { ...base, txHash, hexInput }
}

// ---------------------------------------------------------------------------
// Payload lengkap (byte tipe + RLP)
// ---------------------------------------------------------------------------

/** Transaksi → byte payload: `0x01 ‖ rlp(list)`. */
export const encodeTxPayload = (tx: TxInterface): Uint8Array => {
	const body = rlpEncode(txToRlpList(tx))
	const out = new Uint8Array(body.length + 1)
	out[0] = TX_TYPE_RLP
	out.set(body, 1)
	return out
}

/** Byte payload → transaksi. Melempar bila tipe tidak dikenal atau rusak. */
export const decodeTxPayload = (data: Uint8Array): TxInterface => {
	if (data.length === 0) {
		throw new Error('txCodec: payload kosong')
	}
	const type = data[0]
	if (type !== TX_TYPE_RLP) {
		throw new Error(
			`txCodec: tipe transaksi tidak dikenal: 0x${type.toString(16).padStart(2, '0')}`,
		)
	}
	return rlpListToTx(rlpDecode(data.subarray(1)))
}
