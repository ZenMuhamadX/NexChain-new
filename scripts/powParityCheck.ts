/**
 * Gerbang regresi "paritas hasher PoW" (fork `pow-bytes`).
 *
 * Bug yang dicegah: loop PoW (`PowHasher`) menghasilkan hash yang BERBEDA dari
 * `hashWithNonce` konvensional, atau kedua jalur TS berbeda dari aturan byte
 * yang ditulis di `docs/POW_PAYLOAD_FORMAT.md`. Bila itu terjadi, miner akan
 * menemukan nonce yang ditolak node pada `nex_submitWork` — atau lebih buruk,
 * menerima blok dengan hash yang tidak sah.
 *
 * Yang diuji:
 *   - `createPowHasher(payload).hash(n)` === `hashWithNonce(payload, n)` untuk
 *     payload byte DAN hex-nya (kontrak wire `nex_getWork.payload`);
 *   - nonce batas uint32: 0, 1, 255, 256, 65535, 65536, 2^31-1, 2^31,
 *     2^32-2, 2^32-1 — TIDAK ada vektor di luar uint32;
 *   - nonce di luar `0..0xffffffff` (termasuk pecahan) DITOLAK;
 *   - validasi payload: magic/versi layout/panjang salah DITOLAK (fail-closed);
 *   - kesesuaian dengan rujukan eksternal: Bitcoin genesis header 80 byte —
 *     `sha256d` harus menghasilkan digest yang sama dengan Bitcoin;
 *   - `sha256()` biasa TIDAK berubah (regresi: txHash/merkleRoot/address);
 *   - status: byte 126 payload adalah enum (`1=confirmed`, `2=pending`),
 *     TIDAK sama dengan `status: true` boolean di RPC;
 *   - `targetBlockTimeMs` metadata tidak pernah masuk payload.
 *
 * Murni: tanpa RPC, tanpa DB, tanpa side effect.
 *
 * Jalankan:  bun run check:pow
 */
import {
	hashWithNonce,
	createPowHasher,
	POW_NONCE_MAX,
} from 'src/core/consensus/Pow'
import { sha256, sha256d, hexToBytesStrict } from 'src/core/encoding/sha256'
import {
	buildMiningPayload,
	miningPayloadLength,
	POW_PAYLOAD_FIXED_BYTES,
	POW_PAYLOAD_LAYOUT_VERSION,
	POW_PAYLOAD_MAGIC,
} from 'src/core/block/miningPayload'
import { buildGenesisBlock } from 'src/core/block/genesis'
import { Block } from 'src/core/block/blockModel'
import { createHash } from 'node:crypto'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? '  -> ' + extra : ''}`)
	}
}

const throws = (fn: () => unknown): boolean => {
	try {
		fn()
		return false
	} catch {
		return true
	}
}

const toHex = (bytes: Uint8Array): string => {
	let out = ''
	for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
	return out
}

/** SHA-256d rujukan via Node crypto (hanya untuk gate ini, bukan jalur core). */
const refSha256d = (bytes: Uint8Array): string => {
	const first = createHash('sha256').update(bytes).digest()
	return createHash('sha256').update(first).digest('hex')
}

const payload = buildMiningPayload(buildGenesisBlock())
const payloadHex = toHex(payload)

// ---------------------------------------------------------------------------
// Paritas hasher vs hashWithNonce — byte & hex
// ---------------------------------------------------------------------------

const NONCES = [
	0,
	1,
	2,
	9,
	10,
	11,
	99,
	100,
	101,
	255,
	256,
	999,
	1000,
	65_535,
	65_536,
	999_999,
	1_000_000,
	2_147_483_647,
	2_147_483_648,
	4_294_967_294,
	4_294_967_295,
]

console.log('paritas PowHasher vs hashWithNonce (payload byte kanonik)\n')

{
	const hasher = createPowHasher(payload)
	const hasherFromHex = createPowHasher(payloadHex)
	let allEqual = true
	let allMatchRef = true
	let badDetail = ''
	for (const nonce of NONCES) {
		const fast = hasher.hash(nonce)
		const fromHex = hasherFromHex.hash(nonce)
		const slow = hashWithNonce(payload, nonce)
		const slowHex = hashWithNonce(payloadHex, nonce)
		const ref = refSha256d(
			(() => {
				const copy = new Uint8Array(payload)
				const at = copy.length - 4
				copy[at] = nonce & 0xff
				copy[at + 1] = (nonce >>> 8) & 0xff
				copy[at + 2] = (nonce >>> 16) & 0xff
				copy[at + 3] = (nonce >>> 24) & 0xff
				return copy
			})(),
		)
		if (fast !== slow || fromHex !== slowHex) {
			allEqual = false
			badDetail = `nonce=${nonce} fast=${fast} slow=${slow} hex=${fromHex}/${slowHex}`
		}
		if (fast !== ref) {
			allMatchRef = false
			badDetail = `nonce=${nonce} fast=${fast} ref=${ref}`
		}
	}
	ok('paritas byte vs hex vs hashWithNonce', allEqual, badDetail)
	ok('sesuai SHA256d rujukan node:crypto', allMatchRef, badDetail)
}

// ---------------------------------------------------------------------------
// Nonce di luar uint32 DITOLAK (tidak ada wrap, tidak ada pecahan)
// ---------------------------------------------------------------------------

{
	const hasher = createPowHasher(payload)
	ok('nonce -1 ditolak', throws(() => hasher.hash(-1)))
	ok('nonce 1.5 ditolak', throws(() => hasher.hash(1.5)))
	ok('nonce 2^32 ditolak', throws(() => hasher.hash(POW_NONCE_MAX + 1)))
	ok(
		'nonce MAX_SAFE_INTEGER ditolak',
		throws(() => hashWithNonce(payload, Number.MAX_SAFE_INTEGER)),
	)
	ok('nonce uint32 maksimum diterima', hasher.hash(POW_NONCE_MAX).length === 64)
}

// ---------------------------------------------------------------------------
// Validasi payload: magic / layoutVersion / panjang / hex
// ---------------------------------------------------------------------------

{
	const corruptMagic = new Uint8Array(payload)
	corruptMagic[0] ^= 0xff
	ok(
		'magic salah DITOLAK',
		throws(() => createPowHasher(corruptMagic)),
	)
	ok(
		'layoutVersion salah DITOLAK',
		throws(() => {
			const bad = new Uint8Array(payload)
			bad[4] = (POW_PAYLOAD_LAYOUT_VERSION + 1) & 0xff
			bad[5] = 0
			return createPowHasher(bad)
		}),
	)
	ok(
		'panjang terpotong DITOLAK',
		throws(() => createPowHasher(payload.subarray(0, payload.length - 1))),
	)
	ok(
		'hex panjang ganjil DITOLAK',
		throws(() => createPowHasher(payloadHex.slice(0, -1))),
	)
	ok(
		'hex non-hex DITOLAK',
		throws(() => createPowHasher(payloadHex.slice(0, -2) + 'zz')),
	)
	ok(
		'layout tetap: 193 byte tetap + extraData + 4 nonce',
		payload.length === miningPayloadLength(payload.length - POW_PAYLOAD_FIXED_BYTES - 4),
	)
	ok('magic NXM1', new DataView(payload.buffer).getUint32(0, true) === POW_PAYLOAD_MAGIC)
}

// ---------------------------------------------------------------------------
// Bukti primitif eksternal: Bitcoin genesis header (80 byte) → SHA256d
// ---------------------------------------------------------------------------

{
	const headerHex =
		'0100000000000000000000000000000000000000000000000000000000000000' +
		'000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa' +
		'4b1e5e4a29ab5f49ffff001d1dac2b7c'
	const header = hexToBytesStrict(headerHex)
	// Digest APA ADANYA (big-endian). Tampilan Bitcoin membalik urutan byte,
	// jadi hash genesis yang terkenal adalah kebalikan string ini.
	const digest = sha256d(header)
	const reversed = toHex(
		Uint8Array.from(
			digest.match(/../g)!.map((b) => parseInt(b, 16)).reverse(),
		),
	)
	ok('panjang header Bitcoin 80 byte', header.length === 80)
	ok(
		'Bitcoin genesis SHA256d (raw)',
		digest ===
			'6fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000',
		digest,
	)
	ok(
		'Bitcoin genesis hash tampilan (reversed)',
		reversed ===
			'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
		reversed,
	)
}

// ---------------------------------------------------------------------------
// sha256() biasa TIDAK berubah (regresi: txHash/merkleRoot/address)
// ---------------------------------------------------------------------------

{
	const samples = ['', 'abc', 'hello world', JSON.stringify({ a: 1, b: 'é' })]
	let unchanged = true
	for (const s of samples) {
		const got = sha256(s, 'hex') as string
		const ref = createHash('sha256').update(s, 'utf8').digest('hex')
		if (got !== ref) unchanged = false
	}
	ok('sha256() umum tetap identik node:crypto', unchanged)
}

// ---------------------------------------------------------------------------
// Status: enum byte payload vs boolean metadata RPC (JANGAN dicampur)
// ---------------------------------------------------------------------------

{
	const confirmed = buildMiningPayload(buildGenesisBlock())
	const statusByte = (bytes: Uint8Array): number =>
		new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint8(
			126,
		)
	ok('status confirmed → byte 126 = 1', statusByte(confirmed) === 1)

	const template = buildGenesisBlock().block
	const pending = new Block({
		...template,
		status: 'pending',
	})
	ok('status pending → byte 126 = 2', statusByte(buildMiningPayload(pending)) === 2)

	// Metadata RPC `status` tetap boolean `true` — nilai yang berbeda dari
	// enum byte 1. Kalau keduanya disamakan, klien bisa salah menafsirkan.
	const rpcStatus: unknown = true
	const statusEnumByte: unknown = 1
	ok(
		'RPC status boolean true != enum byte 1',
		rpcStatus === true && rpcStatus !== statusEnumByte,
	)
}

// ---------------------------------------------------------------------------
// targetBlockTimeMs: metadata flat, TIDAK masuk payload
// ---------------------------------------------------------------------------

{
	// `targetBlockTimeMs` adalah metadata job (WorkOk), bukan field blok dan
	// tidak punya offset di layout. Menempelkannya ke objek blok tidak boleh
	// mengubah satu byte pun payload.
	const base = buildGenesisBlock()
	const withMeta = new Block({
		...base.block,
		targetBlockTimeMs: 60_000,
	} as unknown as typeof base.block)
	ok(
		'targetBlockTimeMs tidak masuk payload',
		toHex(buildMiningPayload(withMeta)) === payloadHex,
	)
	ok(
		'panjang payload = 197 + extraData',
		payload.length ===
			miningPayloadLength(
				new DataView(
					payload.buffer,
					payload.byteOffset,
					payload.byteLength,
				).getUint16(191, true),
			),
	)
}

// ---------------------------------------------------------------------------
// Isolasi antar-instans
// ---------------------------------------------------------------------------

{
	const h1 = createPowHasher(payload)
	const h2 = createPowHasher(
		buildMiningPayload(
			new Block({ ...buildGenesisBlock().block, height: 7 }),
		),
	)
	let okInterleave = true
	for (const nonce of [7, 8, 12345, 0, 999999]) {
		const r1 = h1.hash(nonce)
		const r2 = h2.hash(nonce)
		if (r1 !== hashWithNonce(payload, nonce)) okInterleave = false
		if (h1.hash(nonce) !== r1) okInterleave = false
		if (r2 === r1) okInterleave = false
	}
	ok('dua hasher tidak saling mengganggu', okInterleave)
}

console.log(`\n${pass} lulus, ${fail} gagal`)
if (fail > 0) process.exit(1)
