/**
 * Serializer KANONIK preimage PoW — byte buffer (fork `pow-bytes`).
 *
 * Ini SATU-SATUNYA preimage konsensus sejak fork `pow-bytes`: pengganti
 * `prepareBlockForHashing` (JSON) yang lama. Format byte-per-byte
 * didokumentasikan di `docs/POW_PAYLOAD_FORMAT.md` — file itu adalah sumber
 * kebenaran; modul ini implementasi TS-nya, dan miner Rust
 * (`apps/miner-rs/`) mengimplementasikan salinan yang sama.
 *
 * Kenapa byte, bukan JSON:
 *   - miner tidak perlu tahu nama field / urutan key / format angka;
 *   - ukuran payload tidak bergantung pada panjang teks desimal;
 *   - nonce punya SLOT TETAP 4 byte di akhir, jadi loop PoW hanya menulis
 *     `nonce.to_le_bytes()` lalu menghitung `SHA256d(buffer)`.
 *
 * Tidak ada JSON key, whitespace, atau teks desimal di dalam buffer. Semua
 * integer little-endian; hash/alamat adalah byte mentah (bukan hex).
 *
 * Modul ini murni (tanpa I/O / API Node) sehingga aman untuk browser dan
 * bisa dipakai verifier, miner, dan tooling.
 */
import type { Block } from 'src/core/block/blockModel'
import { addressToBytes } from 'src/core/encoding/rlp/codecScalars'

/** Magic 4 byte pertama: `"NXM1"` little-endian. */
export const POW_PAYLOAD_MAGIC = 0x4e584d31

/** Versi layout buffer (bukan versi blok / protokol P2P). */
export const POW_PAYLOAD_LAYOUT_VERSION = 2

/** Panjang bagian tetap sebelum `extraData` (lihat tabel di docs). */
export const POW_PAYLOAD_FIXED_BYTES = 193

/** Slot nonce 4 byte di akhir buffer. */
export const POW_PAYLOAD_NONCE_BYTES = 4

/** Enum `hashingAlgorithm` di payload — satu-satunya nilai yang sah. */
export const POW_HASHING_SHA256D = 1

const STATUS_CONFIRMED = 1
const STATUS_PENDING = 2
const STATUS_OTHER = 0

const HEX64 = /^[0-9a-f]{64}$/
const HEX_EVEN = /^(?:[0-9a-f]{2})*$/
const MERKLE_PREFIX = 'TxC'

const fail = (message: string): never => {
	throw new Error(`miningPayload: ${message}`)
}

/** Hex 64 huruf kecil → 32 byte. */
const hashToBytes = (value: unknown, field: string): Uint8Array => {
	if (typeof value !== 'string' || !HEX64.test(value)) {
		throw new Error(`miningPayload: ${field} harus 64 hex huruf kecil`)
	}
	return hexToBytesUnchecked(value)
}

const hexToBytesUnchecked = (hex: string): Uint8Array => {
	const out = new Uint8Array(hex.length >> 1)
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

/** `merkleRoot` boleh 64-hex atau `TxC` + 64-hex (blok satu transaksi). */
const merkleToBytes = (value: unknown): Uint8Array => {
	if (typeof value !== 'string') {
		throw new Error('miningPayload: merkleRoot harus string')
	}
	let hex: string = value
	if (hex.startsWith(MERKLE_PREFIX)) hex = hex.slice(MERKLE_PREFIX.length)
	if (!HEX64.test(hex)) {
		throw new Error('miningPayload: merkleRoot harus 64 hex (atau TxC + 64 hex)')
	}
	return hexToBytesUnchecked(hex)
}

/** `0x`-prefixed (atau tanpa prefix) hex huruf kecil → byte. */
const extraDataToBytes = (value: unknown): Uint8Array => {
	if (value === undefined) return new Uint8Array(0)
	if (typeof value !== 'string') {
		throw new Error('miningPayload: coinbaseTransaction.extraData harus string')
	}
	const clean = value.startsWith('0x') ? value.slice(2) : value
	if (!HEX_EVEN.test(clean)) {
		throw new Error(
			'miningPayload: coinbaseTransaction.extraData harus hex huruf kecil panjang genap',
		)
	}
	return hexToBytesUnchecked(clean)
}

const assertUint = (value: unknown, field: string, max: number): number => {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > max
	) {
		throw new Error(`miningPayload: ${field} harus bilangan bulat 0..${max}`)
	}
	return value
}

const assertU64 = (value: unknown, field: string): number => {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 0
	) {
		throw new Error(`miningPayload: ${field} harus bilangan bulat aman >= 0`)
	}
	return value
}

/** `"MAJOR.MINOR.PATCH"` → tiga u8. */
const parseVersion = (value: unknown): [number, number, number] => {
	if (typeof value !== 'string') {
		throw new Error('miningPayload: header.version harus string')
	}
	const parts = value.split('.')
	if (parts.length !== 3) {
		throw new Error(`miningPayload: header.version harus MAJOR.MINOR.PATCH: ${value}`)
	}
	const nums = parts.map((part: string): number => {
		if (!/^\d+$/.test(part)) {
			throw new Error(`miningPayload: header.version tidak numerik: ${value}`)
		}
		const n = Number(part)
		if (!Number.isSafeInteger(n) || n < 0 || n > 0xff) {
			throw new Error(`miningPayload: header.version di luar u8: ${value}`)
		}
		return n
	})
	return [nums[0], nums[1], nums[2]]
}

const hashingAlgorithmCode = (value: unknown): number => {
	if (value !== 'SHA256D') {
		throw new Error(
			`miningPayload: header.hashingAlgorithm tidak dikenal: ${String(value)}`,
		)
	}
	return POW_HASHING_SHA256D
}

const statusCode = (value: unknown): number => {
	if (value === 'confirmed') return STATUS_CONFIRMED
	if (value === 'pending') return STATUS_PENDING
	return STATUS_OTHER
}

/** Panjang total payload untuk `extraData` sepanjang `extraDataLen` byte. */
export const miningPayloadLength = (extraDataLen: number): number =>
	POW_PAYLOAD_FIXED_BYTES + extraDataLen + POW_PAYLOAD_NONCE_BYTES

/**
 * Serialize blok menjadi payload PoW kanonik.
 *
 * Slot nonce di akhir SELALU ditulis `0` — template belum punya solusi, dan
 * `hashWithNonce`/`createPowHasher` yang menambal 4 byte itu per percobaan.
 * Karena itu fungsi ini tidak membaca `header.nonce`/`header.hash`.
 */
export const buildMiningPayload = (block: Block): Uint8Array => {
	const data = block.block
	const header = data.header

	const previousBlockHash = hashToBytes(
		header.previousBlockHash,
		'header.previousBlockHash',
	)
	const stateRoot = hashToBytes(header.stateRoot, 'header.stateRoot')
	const merkleRoot = merkleToBytes(data.merkleRoot)
	const minerId = addressToBytes(data.minerId, 'miningPayload')
	const coinbaseReceiver = addressToBytes(
		data.coinbaseTransaction.receiver,
		'miningPayload',
	)
	const extraData = extraDataToBytes(data.coinbaseTransaction.extraData)
	if (extraData.length > 0xffff) {
		fail('coinbaseTransaction.extraData melebihi 65535 byte')
	}

	const timestamp = assertU64(header.timestamp, 'header.timestamp')
	const blockReward = assertU64(data.blockReward, 'blockReward')
	const totalReward = assertU64(data.totalReward, 'totalReward')
	const coinbaseAmount = assertU64(
		data.coinbaseTransaction.amount,
		'coinbaseTransaction.amount',
	)
	const bits = assertUint(header.difficulty, 'header.difficulty', 0xffffffff)
	const height = assertUint(data.height, 'height', 0xffffffff)
	const chainId = assertUint(data.chainId, 'chainId', 0xffffffff)
	const [versionMajor, versionMinor, versionPatch] = parseVersion(
		header.version,
	)
	const algorithm = hashingAlgorithmCode(header.hashingAlgorithm)
	const status = statusCode(data.status)

	const out = new Uint8Array(miningPayloadLength(extraData.length))
	const view = new DataView(out.buffer)
	view.setUint32(0, POW_PAYLOAD_MAGIC, true)
	view.setUint16(4, POW_PAYLOAD_LAYOUT_VERSION, true)
	out.set(previousBlockHash, 6)
	view.setBigUint64(38, BigInt(timestamp), true)
	out[46] = versionMajor
	out[47] = versionMinor
	out[48] = versionPatch
	out[49] = algorithm
	view.setUint32(50, bits, true)
	out.set(stateRoot, 54)
	view.setUint32(86, height, true)
	out.set(merkleRoot, 90)
	view.setUint32(122, chainId, true)
	out[126] = status
	view.setBigUint64(127, BigInt(blockReward), true)
	out.set(minerId, 135)
	view.setBigUint64(155, BigInt(totalReward), true)
	view.setBigUint64(163, BigInt(coinbaseAmount), true)
	out.set(coinbaseReceiver, 171)
	view.setUint16(191, extraData.length, true)
	out.set(extraData, POW_PAYLOAD_FIXED_BYTES)
	// Slot nonce (4 byte terakhir) tetap 0 — ditambal hasher.
	return out
}

/**
 * Validasi bentuk payload yang diterima dari luar (hex `nex_getWork` atau
 * buffer yang diserahkan klien): magic, versi layout, dan konsistensi
 * `extraDataLen` dengan panjang total. Fail-closed.
 */
export const assertMiningPayloadBytes = (bytes: Uint8Array): void => {
	if (!(bytes instanceof Uint8Array)) fail('payload harus Uint8Array')
	if (bytes.length < miningPayloadLength(0)) {
		fail(`payload terlalu pendek: ${bytes.length} byte`)
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (view.getUint32(0, true) !== POW_PAYLOAD_MAGIC) {
		fail('magic payload tidak dikenal (bukan NXM1)')
	}
	if (view.getUint16(4, true) !== POW_PAYLOAD_LAYOUT_VERSION) {
		fail(
			`layoutVersion payload ${view.getUint16(4, true)} != ${POW_PAYLOAD_LAYOUT_VERSION}`,
		)
	}
	const extraDataLen = view.getUint16(191, true)
	if (bytes.length !== miningPayloadLength(extraDataLen)) {
		fail(
			`panjang payload ${bytes.length} tidak cocok dengan extraDataLen ${extraDataLen}`,
		)
	}
}

/**
 * Baca `bits` dari payload. Dipakai sebagai asersi bahwa metadata job
 * (`job.difficulty`) sama dengan field yang benar-benar di-hash miner.
 */
export const readPayloadBits = (bytes: Uint8Array): number => {
	assertMiningPayloadBytes(bytes)
	return new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getUint32(50, true)
}

/** Baca slot nonce (4 byte terakhir, little-endian). */
export const readPayloadNonce = (bytes: Uint8Array): number => {
	assertMiningPayloadBytes(bytes)
	return new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getUint32(bytes.length - POW_PAYLOAD_NONCE_BYTES, true)
}
