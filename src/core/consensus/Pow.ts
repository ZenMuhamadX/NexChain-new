import { hexToBytesStrict, sha256d } from 'src/core/encoding/sha256'
import {
	assertMiningPayloadBytes,
	POW_PAYLOAD_NONCE_BYTES,
} from 'src/core/block/miningPayload'

/**
 * Hash PoW NexChain = `SHA256d(payloadBytes)` dengan slot nonce 4 byte di
 * akhir payload ditambal `nonce.to_le_bytes()`.
 *
 * `payload` adalah byte kanonik dari `buildMiningPayload(block)` — SATU-SATUNYA
 * preimage konsensus sejak fork `pow-bytes` (lihat
 * `docs/POW_PAYLOAD_FORMAT.md`). Bentuk string yang diterima adalah HEX dari
 * buffer itu (yang dikirim `nex_getWork.payload`); string di-decode KETAT
 * lalu divalidasi magic/layoutVersion/panjangnya, jadi payload asing tidak
 * pernah di-hash diam-diam.
 *
 * Fungsi ini murni (hanya js-sha256) dan aman dipakai miner eksternal.
 *
 * Catatan performa: ini jalur KONVENIEN (satu hash). Untuk loop mining yang
 * mengevaluasi banyak nonce atas payload yang sama, pakai
 * `createPowHasher(payload)` — hasilnya identik tetapi lebih cepat karena
 * buffer hanya disiapkan sekali.
 */
export const hashWithNonce = (
	input: Uint8Array | string,
	nonce: number,
): string => {
	assertNonce(nonce)
	const bytes = new Uint8Array(toPayloadBytes(input))
	writeNonceLe(bytes, nonce)
	return sha256d(bytes)
}

/**
 * Batas nonce: `uint32` (`0..0xffffffff`). Di luar itu submit ditolak —
 * tidak ada wrap dan tidak ada nonce pecahan.
 */
export const POW_NONCE_MAX = 0xffffffff

const assertNonce = (nonce: number): void => {
	if (
		typeof nonce !== 'number' ||
		!Number.isSafeInteger(nonce) ||
		nonce < 0 ||
		nonce > POW_NONCE_MAX
	) {
		throw new Error(
			`PoW nonce harus bilangan bulat 0..${POW_NONCE_MAX}, dapat ${nonce}`,
		)
	}
}

const toPayloadBytes = (input: Uint8Array | string): Uint8Array => {
	const bytes =
		typeof input === 'string' ? hexToBytesStrict(input) : input
	assertMiningPayloadBytes(bytes)
	return bytes
}

const writeNonceLe = (bytes: Uint8Array, nonce: number): void => {
	const at = bytes.length - POW_PAYLOAD_NONCE_BYTES
	// `>>>` = ToUint32, aman karena `assertNonce` sudah menjepit 0..2^32-1.
	bytes[at] = nonce & 0xff
	bytes[at + 1] = (nonce >>> 8) & 0xff
	bytes[at + 2] = (nonce >>> 16) & 0xff
	bytes[at + 3] = (nonce >>> 24) & 0xff
}

/**
 * Hasher PoW ber-payload-tetap untuk loop mining.
 *
 * `hasher.hash(nonce)` byte-per-byte identik dengan
 * `hashWithNonce(payload, nonce)` — dibuktikan gate `scripts/powParityCheck.ts`.
 * Buffer payload divalidasi & disalin SEKALI di konstruktor; tiap
 * `hash(nonce)` hanya menulis 4 byte nonce di akhir buffer tetap itu lalu
 * menghitung SHA256d.
 *
 * Contoh:
 *   const hasher = createPowHasher(work.payload) // hex dari nex_getWork
 *   for (let nonce = 0; nonce <= POW_NONCE_MAX; nonce++) {
 *     if (meetsDifficulty(hasher.hash(nonce), bits)) break
 *   }
 */
export class PowHasher {
	private readonly buffer: Uint8Array

	constructor(input: Uint8Array | string) {
		// Salin supaya mutasi pemanggil tidak merusak prefix yang di-precompute.
		this.buffer = new Uint8Array(toPayloadBytes(input))
	}

	hash(nonce: number): string {
		assertNonce(nonce)
		writeNonceLe(this.buffer, nonce)
		return sha256d(this.buffer)
	}
}

export const createPowHasher = (input: Uint8Array | string): PowHasher =>
	new PowHasher(input)
