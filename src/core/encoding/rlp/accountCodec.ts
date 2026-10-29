/**
 * Leaf akun v1 — satu-satunya bentuk nilai di store `state` untuk sebuah alamat.
 *
 *   RLP([version, nonce, balance, txCount, lastTxTime])
 *
 * Kunci = alamat. `address` tidak disimpan (sudah menjadi kunci) dan
 * `isContract` tidak ada sama sekali (rantai ini tanpa kontrak; nilainya tidak
 * pernah bisa `true`).
 *
 * `lastTxTime` = timestamp BLOK (epoch ms), BUKAN jam dinding node. State harus
 * identik di setiap node yang mengeksekusi blok yang sama; `Date.now()` di sini
 * akan membuat `stateRoot` bercabang di blok pertama. `null` (akun tanpa
 * transaksi) diwakili 0 — timestamp blok nyata tidak pernah 0.
 *
 * Nilai disimpan sebagai hex dari byte RLP (bukan lagi hex-dari-JSON, yang
 * mengenkode dua kali). Versi ada DI DALAM leaf supaya nilai lama bisa ditolak
 * dengan pesan jelas, bukan dibaca sebagai saldo 0.
 */
import {
	bytesToHex,
	bytesToNumber,
	hexToBytes,
	numberToBytes,
} from './codecScalars'
import { rlpDecode } from './rlpDecode'
import { rlpEncode, type RlpInput } from './rlpEncode'
import type { structBalance } from 'src/types/balance'
import type { HexString } from 'src/types/block'

/** Versi skema leaf. Naikkan bila bentuk leaf berubah (butuh migrasi/fork). */
export const ACCOUNT_STATE_VERSION = 1

const LABEL = 'accountCodec'
const ITEM_COUNT = 5

export const encodeAccount = (account: structBalance): HexString => {
	const leaf: RlpInput[] = [
		numberToBytes(ACCOUNT_STATE_VERSION, 'version', LABEL),
		numberToBytes(account.nonce ?? 0, 'nonce', LABEL),
		numberToBytes(account.balance, 'balance', LABEL),
		numberToBytes(account.transactionCount ?? 0, 'txCount', LABEL),
		numberToBytes(account.lastTransactionDate ?? 0, 'lastTxTime', LABEL),
	]
	return `0x${bytesToHex(rlpEncode(leaf))}`
}

/**
 * @throws Error bila nilai bukan leaf v1 — termasuk data lama berbentuk
 *         JSON. Fail-closed: saldo tak terbaca TIDAK boleh menjadi 0.
 */
export const decodeAccount = (
	value: HexString,
	address: string,
): structBalance => {
	let list: RlpInput
	try {
		list = rlpDecode(hexToBytes(value))
	} catch {
		throw unknownLeaf(address)
	}
	if (!Array.isArray(list) || list.length !== ITEM_COUNT) {
		throw unknownLeaf(address)
	}

	const item = (index: number, field: string): Uint8Array => {
		const bytes = list[index]
		if (!(bytes instanceof Uint8Array)) {
			throw new Error(`${LABEL}: item ${index} (${field}) harus byte string`)
		}
		return bytes
	}

	const version = bytesToNumber(item(0, 'version'), 'version', LABEL)
	if (version !== ACCOUNT_STATE_VERSION) {
		throw new Error(
			`${LABEL}: state ${address} memakai versi ${version}, ` +
				`kode ini hanya mengenal ${ACCOUNT_STATE_VERSION}. ` +
				`Hapus direktori data (NEX_DATA_DIR) atau migrasikan state.`,
		)
	}

	const lastTxTime = bytesToNumber(item(4, 'lastTxTime'), 'lastTxTime', LABEL)

	return {
		address,
		nonce: bytesToNumber(item(1, 'nonce'), 'nonce', LABEL),
		balance: bytesToNumber(item(2, 'balance'), 'balance', LABEL),
		transactionCount: bytesToNumber(item(3, 'txCount'), 'txCount', LABEL),
		lastTransactionDate: lastTxTime === 0 ? null : lastTxTime,
	}
}

const unknownLeaf = (address: string): Error =>
	new Error(
		`${LABEL}: nilai state ${address} bukan leaf akun v1 ` +
			`(bentuk lama JSON sebelum v0.1?). Hapus direktori data ` +
			`(NEX_DATA_DIR) — saldo TIDAK dibaca sebagai 0.`,
	)
