/**
 * Transaksi Ethereum legacy (EIP-155) yang diterima jaringan lewat gateway.
 *
 * Beda dengan `txCodec` (`0x02`):
 *   - yang ditandatangani `keccak(rlp([..., chainId, 0, 0]))`, bukan SHA-256;
 *   - `to` dan pengirim memakai 20 byte Ethereum apa adanya, diberi prefix
 *     `NxC` di ledger. Tidak ada konversi alamat: tanda tangan mengikat
 *     byte `to`, jadi byte itulah identitas akun penerima.
 *
 * Payload wire tetap `tipe ‖ rlp`, dan identitas transaksi TETAP
 * `TxC + sha256(payload)` seperti tipe `0x02` — yang berubah hanya cara
 * memulihkan pengirim dan cara membaca field.
 */

import { ec as EC } from 'elliptic'
import { CHAIN_ID } from 'src/crypto/chainId'
import { recoverPublicKey, type sign } from 'src/crypto/recoverPublicKey'
import { sha256 } from 'src/core/encoding/sha256'
import { keccak256 } from 'src/core/encoding/keccak256'
import type { HexString } from 'src/types/block'
import type { TxInterface } from 'src/types/transaction'
import { TX_HASH_PREFIX } from './txHash'
import { getCachedSender, rememberSender } from './senderCache'
import { rlpDecode } from './rlpDecode'
import { rlpEncode, type RlpInput } from './rlpEncode'
import {
	bytesToAddress,
	bytesToData,
	bytesToHex,
	bytesToNumber,
	dataToBytes,
	hexToBytes,
	numberToBytes,
} from './codecScalars'

/** Byte tipe transaksi Ethereum yang diterima node. */
export const ETH_TX_TYPE = 0x03

const WEI_PER_NEXU = 10n ** 10n
const ec = new EC('secp256k1')

interface EthFields {
	nonce: number
	gasPrice: bigint
	gasLimit: bigint
	to: Uint8Array
	value: bigint
	data?: HexString
	sign: sign
}

const asBytes = (value: RlpInput, index: number, field: string): Uint8Array => {
	if (!(value instanceof Uint8Array))
		throw new Error(`ethTxCodec: item ${index} (${field}) harus byte string`)
	return value
}

/** Byte big-endian → BigInt (tanpa prefix harus diberi `0x` secara eksplisit). */
const bytesToBig = (bytes: Uint8Array): bigint =>
	BigInt(`0x${bytesToHex(bytes) || '0'}`)

/**
 * BigInt → bytes RLP minimal. Tidak lewat `Number`: `value` MetaMask adalah
 * wei (1 NXC = 10^18 wei), jauh di atas batas bilangan bulat aman.
 */
const bigToBytes = (value: bigint, field: string): Uint8Array => {
	if (value < 0n) throw new Error(`ethTxCodec: ${field} tidak boleh negatif`)
	let remaining = value
	const out: number[] = []
	while (remaining > 0n) {
		out.unshift(Number(remaining % 256n))
		remaining /= 256n
	}
	return new Uint8Array(out)
}

/** wei → nexu eksak; sisa satuwei pun ditolak, tidak dibulatkan. */
const weiToNexu = (wei: bigint, field: string): number => {
	if (wei % WEI_PER_NEXU !== 0n)
		throw new Error(`ethTxCodec: ${field} bukan kelipatan 10^10 wei`)
	const value = wei / WEI_PER_NEXU
	if (!Number.isSafeInteger(Number(value)))
		throw new Error(`ethTxCodec: ${field} melewati batas bilangan bulat aman`)
	return Number(value)
}

/**
 * Parse RLP signed legacy tx. Kanonisitas dijaga dengan menyusun ulang list
 * dan membandingkan byte-nya — payload yang dikirim harus persis yang ditandatangani.
 */
const parseEthFields = (raw: Uint8Array): EthFields => {
	const list = rlpDecode(raw)
	if (!Array.isArray(list) || list.length !== 9)
		throw new Error('ethTxCodec: raw transaksi harus list RLP 9 item')

	const to = asBytes(list[3], 3, 'to')
	if (to.length !== 20) throw new Error('ethTxCodec: to harus 20 byte')

	const v = bytesToNumber(asBytes(list[6], 6, 'v'), 'v', 'ethTxCodec')
	const recovery = v - (CHAIN_ID * 2 + 35)
	if (recovery !== 0 && recovery !== 1)
		throw new Error(`ethTxCodec: chainId tidak cocok (v=${v})`)

	const r = bytesToHex(asBytes(list[7], 7, 'r'))
	const s = bytesToHex(asBytes(list[8], 8, 's'))
	if (r.length !== 64 || s.length !== 64)
		throw new Error('ethTxCodec: r/s harus 32 byte')

	const fields: EthFields = {
		nonce: bytesToNumber(asBytes(list[0], 0, 'nonce'), 'nonce', 'ethTxCodec'),
		gasPrice: bytesToBig(asBytes(list[1], 1, 'gasPrice')),
		gasLimit: bytesToBig(asBytes(list[2], 2, 'gasLimit')),
		to,
		value: bytesToBig(asBytes(list[4], 4, 'value')),
		sign: { v, r, s },
	}
	const data = bytesToData(asBytes(list[5], 5, 'data'))
	if (data !== undefined) fields.data = data

	const signedList: RlpInput[] = [
		numberToBytes(fields.nonce, 'nonce', 'ethTxCodec'),
		bigToBytes(fields.gasPrice, 'gasPrice'),
		bigToBytes(fields.gasLimit, 'gasLimit'),
		to,
		bigToBytes(fields.value, 'value'),
		dataToBytes(fields.data, 'ethTxCodec'),
		numberToBytes(v, 'v', 'ethTxCodec'),
		hexToBytes(r),
		hexToBytes(s),
	]
	if (bytesToHex(rlpEncode(signedList)) !== bytesToHex(raw))
		throw new Error('ethTxCodec: raw transaksi tidak kanonik')

	return fields
}

const preimage = (fields: EthFields): Uint8Array =>
	rlpEncode([
		numberToBytes(fields.nonce, 'nonce', 'ethTxCodec'),
		bigToBytes(fields.gasPrice, 'gasPrice'),
		bigToBytes(fields.gasLimit, 'gasLimit'),
		fields.to,
		bigToBytes(fields.value, 'value'),
		dataToBytes(fields.data, 'ethTxCodec'),
		numberToBytes(CHAIN_ID, 'chainId', 'ethTxCodec'),
		new Uint8Array(0),
		new Uint8Array(0),
	])

/** Digest EIP-155 yang ditandatangani MetaMask. */
export const ethTxSighash = (raw: Uint8Array): Uint8Array =>
	hexToBytes(keccak256(preimage(parseEthFields(raw))))

/**
 * Pengirim bridge: alamat Ethereum hasil `ecrecover`, dipakai apa adanya
 * sebagai 20 byte alamat `NxC…` di ledger.
 */
export const ethTxFrom = (raw: Uint8Array): string | undefined => {
	try {
		const fields = parseEthFields(raw)
		const hash = hexToBytes(keccak256(preimage(fields)))
		const { publicKey } = recoverPublicKey(hash, fields.sign)
		const key = ec.keyFromPublic(publicKey, 'hex')
		if (!key.verify(hash, { r: fields.sign.r, s: fields.sign.s }))
			return undefined
		const uncompressed = key.getPublic(false, 'hex')
		const eth = keccak256(hexToBytes(uncompressed.slice(2))).slice(-40)
		return `NxC${eth}`
	} catch {
		return undefined
	}
}

/** Payload wire: `0x03 ‖ raw` — raw tidak diubah sedikit pun. */
export const encodeEthTxPayload = (tx: TxInterface): Uint8Array => {
	if (typeof tx.raw !== 'string' || tx.raw.length === 0)
		throw new Error('ethTxCodec: raw transaksi Ethereum tidak ada')
	const body = hexToBytes(tx.raw)
	const out = new Uint8Array(body.length + 1)
	out[0] = ETH_TX_TYPE
	out.set(body, 1)
	return out
}

/** Byte payload → TxInterface lengkap, siap masuk mempool node. */
export const decodeEthTxPayload = (data: Uint8Array): TxInterface => {
	if (data.length < 2 || data[0] !== ETH_TX_TYPE)
		throw new Error('ethTxCodec: payload tipe 0x03 tidak valid')
	const raw = data.subarray(1)
	const fields = parseEthFields(raw)
	const txHash = TX_HASH_PREFIX + (sha256(data, 'hex') as string)
	const cached = getCachedSender(txHash)
	const from = cached ?? ethTxFrom(raw)
	if (cached === undefined && from !== undefined) rememberSender(txHash, from)
	return {
		type: ETH_TX_TYPE,
		nonce: fields.nonce,
		fee: weiToNexu(fields.gasPrice * fields.gasLimit, 'fee'),
		receiver: bytesToAddress(fields.to),
		amount: weiToNexu(fields.value, 'amount'),
		...(fields.data === undefined ? {} : { data: fields.data }),
		sign: fields.sign,
		raw: `0x${bytesToHex(raw)}`,
		txHash,
		...(from === undefined ? {} : { from }),
	}
}
