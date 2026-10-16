/**
 * Skema wire transaksi NexChain — pemetaan `TxInterface` ke list RLP.
 *
 * Ini DEFINISI KONTRAK antara wallet (yang meng-encode) dan node (yang
 * meng-decode). Keduanya memakai file ini, sehingga tidak mungkin berbeda
 * pendapat soal urutan field.
 *
 * Bentuk payload (tipe `0x02`, pola EIP-2718):
 *
 *     unsigned = [ chainId, nonce, fee, receiver, amount, data ]     (6 item)
 *     sighash  = sha256(rlp(unsigned))                    ← yang di-sign
 *     signed   = [ nonce, fee, receiver, amount, data, v, r, s ]     (8 item)
 *     payload  = 0x02 ‖ rlp(signed)
 *     txHash   = sha256(payload)                          ← identitas
 *
 * ## Pengirim TIDAK dikirim
 *
 * `sender` tidak ada di wire. Pengirim dipulihkan dari tanda tangan lewat
 * `ecrecover(sighash, v, r, s)` — `from`. Ini model Ethereum: tanda tangan
 * ADALAH definisi pengirim.
 *
 * Konsekuensinya lebih dari sekadar hemat 22 byte:
 *
 *   - Tidak ada lagi "klaim" pengirim yang harus dicocokkan dengan kenyataan.
 *     Sebelumnya node memverifikasi `signer === sender`; sekarang nilai hasil
 *     pemulihan langsung menjadi `from`, sehingga tidak mungkin ada
 *     ketidakcocokan.
 *   - `from` tidak bisa dipalsukan tanpa memalsukan tanda tangan, karena ia
 *     dihitung DARI tanda tangan itu.
 *
 * ## Dua hash, bukan satu
 *
 * Sebelumnya `txHash` merangkap dua peran sekaligus: yang ditandatangani DAN
 * identitasnya. Pemisahan inilah yang membuat `txHash` benar-benar mengikat
 * byte yang dikirim:
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
 * `format`, `timestamp`, `hexInput`, dan seluruh state siklus hidup
 * (`status`/`isValid`/`isPending`) TIDAK lagi menjadi bagian transaksi
 * maupun wire.
 */

import { TxInterface } from 'src/types/transaction'
import { CHAIN_ID } from 'src/crypto/chainId'
import { recoverSignerAddress } from 'src/crypto/verifySignature'
import { sha256 } from 'src/core/encoding/sha256'
import { rlpEncode, type RlpInput } from './rlpEncode'
import { rlpDecode } from './rlpDecode'
import { TX_HASH_PREFIX } from './txHash'
// Primitive byte <-> skalar hidup di satu modul bersama codec blok; lihat
// catatan di `codecScalars.ts` soal alasan pemisahannya.
import {
	addressToBytes,
	bytesToAddress,
	bytesToData,
	bytesToHex,
	bytesToNumber,
	dataToBytes,
	hexToBytes,
	LOWERCASE_HEX,
	numberToBytes,
} from './codecScalars'

// Prefix didefinisikan di modul murni `./txHash` supaya lapisan P2P/protokol
// bisa memvalidasinya tanpa menyeret seluruh kodek RLP — dan supaya tidak ada
// dua definisi prefix yang bisa berbeda. Re-export menjaga permukaan publik
// `txCodec` yang sudah didokumentasikan.
export { TX_HASH_PREFIX } from './txHash'

/** Byte tipe transaksi (EIP-2718). `0x01` = skema RLP lama. */
export const TX_TYPE = 0x02

/** Panjang list yang valid — bagian dari kontrak, bukan angka bebas. */
export const UNSIGNED_ITEM_COUNT = 6
export const SIGNED_ITEM_COUNT = 8

const SIGNATURE_BYTES = 32

// ---------------------------------------------------------------------------
// Data & tanda tangan
// ---------------------------------------------------------------------------

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
		addressToBytes(tx.receiver),
		numberToBytes(tx.amount, 'amount'),
		dataToBytes(tx.data),
		numberToBytes(tx.sign.v, 'v'),
		signatureHexToBytes(tx.sign.r, 'r'),
		signatureHexToBytes(tx.sign.s, 's'),
	]
}

/**
 * Kebalikan `txToRlpList`.
 *
 * `from` dan `txHash` TIDAK diisi di sini — keduanya turunan. `decodeTxPayload`
 * yang melengkapinya (satu lewat `ecrecover`, satu lewat hash payload).
 */
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

	const data = bytesToData(item(4, 'data'))

	return {
		nonce: bytesToNumber(item(0, 'nonce'), 'nonce'),
		fee: bytesToNumber(item(1, 'fee'), 'fee'),
		receiver: bytesToAddress(item(2, 'receiver')),
		amount: bytesToNumber(item(3, 'amount'), 'amount'),
		// Sebar bersyarat: `exactOptionalPropertyTypes` menolak `data:
		// undefined` eksplisit, dan menyebar `{}` menjaga `data` tetap absen.
		...(data === undefined ? {} : { data }),
		sign: {
			v: bytesToNumber(item(5, 'v'), 'v'),
			r: signatureBytesToHex(item(6, 'r'), 'r'),
			s: signatureBytesToHex(item(7, 's'), 's'),
		},
	}
}

// ---------------------------------------------------------------------------
// Hash & payload
// ---------------------------------------------------------------------------

/** Hash yang DITANDATANGANI — 32 byte. */
export const txSighash = (tx: TxInterface): Uint8Array =>
	sha256(rlpEncode(txUnsignedRlpList(tx)), 'buffer') as Uint8Array

/**
 * Pengirim — TURUNAN, bukan field yang dikirim.
 *
 * `ecrecover` atas `(sighash, v, r, s)`. Mengembalikan `undefined` bila
 * tanda tangan tidak bisa dipulihkan (r/s/v rusak) — pemanggil memperlakukannya
 * sebagai transaksi tidak sah, bukan sebagai transaksi tanpa pengirim.
 *
 * Perhatikan: `recoverPubKey` pada signature apa pun SELALU menghasilkan
 * sebuah public key, jadi nilai kembaliannya hanya bermakna bila tanda
 * tangannya benar-benar dibuat oleh pemilik alamat itu. Di sini hal itu
 * otomatis: alamat hasil pemulihan ITULAH pengirimnya — tidak ada klaim lain
 * untuk dibandingkan.
 */
export const txFrom = (tx: TxInterface): string | undefined =>
	recoverSignerAddress(txSighash(tx), tx.sign)

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

/**
 * Byte payload → transaksi LENGKAP: `from` dipulihkan, `txHash` dihitung.
 *
 * Keduanya sengaja diisi di sini supaya hasil decode adalah objek yang
 * konsisten dengan dirinya sendiri — tidak ada jalan bagi pemanggil untuk
 * "lupa" menghitung pengirim, dan tidak ada nilai pengirim dari luar yang
 * bisa menyelinap masuk.
 */
export const decodeTxPayload = (data: Uint8Array): TxInterface => {
	if (data.length === 0) throw new Error('txCodec: payload kosong')
	if (data[0] !== TX_TYPE) {
		throw new Error(
			`txCodec: tipe transaksi tidak dikenal: 0x${data[0]
				.toString(16)
				.padStart(2, '0')}`,
		)
	}
	const base = rlpListToTx(rlpDecode(data.subarray(1)))
	const from = txFrom(base)
	return {
		...base,
		...(from === undefined ? {} : { from }),
		txHash: txHashOfPayload(data),
	}
}
