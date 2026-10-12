/**
 * Gerbang regresi "paritas hasher PoW".
 *
 * Bug yang dicegah: optimasi loop PoW (`PowHasher`, jalur byte ber-buffer
 * tetap) menghasilkan hash yang BERBEDA dari `hashWithNonce` konvensional.
 * Bila itu terjadi, miner akan menemukan nonce yang ditolak node pada
 * `nex_submitWork` — atau lebih buruk, menerima blok dengan hash yang tidak
 * sah. Gate ini membuktikan keduanya identik byte-per-byte untuk seluruh
 * kelas input yang realistis.
 *
 * Yang diuji:
 *   - `createPowHasher(payload).hash(n)` === `hashWithNonce(payload, n)`
 *     untuk payload ASCII, UTF-8 non-ASCII, unicode, dan payload kosong;
 *   - nonce batas: 0, 1, 9, 10, 999, 1000, 99999, 1e6, 2^31, MAX_SAFE_INTEGER;
 *   - konsistensi berulang (hasher yang sama, dipanggil 2x nonce yang sama);
 *   - kesesuaian dengan rujukan eksternal (node:crypto) — membuktikan
 *     implementasi byte memang SHA-256 standar, bukan sekadar "sama-sama salah";
 *   - lintas-instans: dua hasher berbeda payload tidak saling mengganggu.
 *
 * Murni: tanpa RPC, tanpa DB, tanpa side effect.
 *
 * Jalankan:  bun run check:pow
 */
import { hashWithNonce, createPowHasher } from 'src/core/consensus/Pow'
import { sha256 } from 'src/core/encoding/sha256'
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

/** SHA-256 rujukan: payload+nonce sebagai UTF-8 via Node crypto. */
const refHash = (payload: string, nonce: number): string =>
	createHash('sha256').update(`${payload}${nonce}`, 'utf8').digest('hex')

// ---------------------------------------------------------------------------
// Payload uji — bervariasi dari ASCII murni sampai unicode ber-byte-banyak
// ---------------------------------------------------------------------------

const PAYLOADS: Array<[string, string]> = [
	['kosong', ''],
	['ascii pendek', 'abc'],
	[
		'preimage mirip blok',
		JSON.stringify({
			previousBlockHash:
				'a3f1c9e2b7d4085f6a1c3e5b7d9f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f',
			timestamp: 1760000000000,
			version: 1,
			hashingAlgorithm: 'sha256',
			height: 1234,
			merkleRoot:
				'b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6',
			chainId: 1,
			status: 'confirmed',
			blockReward: '5000000000',
			transactions: [],
		}),
	],
	['utf8 aksen', 'café-naïve-Ünïcode'],
	['unicode CJK', '中文测试区块链'],
	['emoji', 'block 🔗 mined ⛏️'],
	['campuran panjang', 'a'.repeat(200) + 'é'.repeat(50) + '汉'.repeat(50)],
]

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
	999,
	1000,
	9999,
	10000,
	99999,
	100000,
	999999,
	1_000_000,
	12_345_678,
	2_147_483_647,
	1_000_000_000_007,
	Number.MAX_SAFE_INTEGER,
]

console.log('paritas PowHasher vs hashWithNonce\n')

for (const [label, payload] of PAYLOADS) {
	let allEqual = true
	let allMatchRef = true
	let badDetail = ''
	const hasher = createPowHasher(payload)
	for (const nonce of NONCES) {
		const fast = hasher.hash(nonce)
		const slow = hashWithNonce(payload, nonce)
		const ref = refHash(payload, nonce)
		if (fast !== slow) {
			allEqual = false
			badDetail = `nonce=${nonce} fast=${fast} slow=${slow}`
		}
		if (fast !== ref) {
			allMatchRef = false
			badDetail = `nonce=${nonce} fast=${fast} ref=${ref}`
		}
	}
	ok(`paritas vs hashWithNonce — ${label}`, allEqual, badDetail)
	ok(`sesuai node:crypto — ${label}`, allMatchRef, badDetail)
}

// ---------------------------------------------------------------------------
// Ketahanan: hasher yang sama dipanggil ulang harus memberi hasil sama
// ---------------------------------------------------------------------------

{
	const h = createPowHasher('repeat-payload-test')
	const a1 = h.hash(42)
	const a2 = h.hash(42)
	const b = h.hash(43)
	ok('hash berulang nonce sama itu stabil', a1 === a2)
	ok('nonce berbeda memberi hash berbeda', a1 !== b)
	ok('hasil berulang cocok rujukan', a1 === refHash('repeat-payload-test', 42))
}

// ---------------------------------------------------------------------------
// Isolasi antar-instans: hasher paralel tidak saling menimpa buffer
// ---------------------------------------------------------------------------

{
	const h1 = createPowHasher('payload-satu')
	const h2 = createPowHasher('payload-dua-yang-jauh-lebih-panjang-'.repeat(5))
	// selang-seling — meniru dua worker/dua payload bergantian
	let okInterleave = true
	for (const nonce of [7, 8, 12345, 0, 999999]) {
		const r1 = h1.hash(nonce)
		const r2 = h2.hash(nonce)
		if (r1 !== refHash('payload-satu', nonce)) okInterleave = false
		if (r2 !== refHash('payload-dua-yang-jauh-lebih-panjang-'.repeat(5), nonce))
			okInterleave = false
		// ulangi h1 setelah h2 — pastikan buffer h1 tidak rusak oleh h2
		if (h1.hash(nonce) !== r1) okInterleave = false
	}
	ok('dua hasher tidak saling mengganggu', okInterleave)
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

console.log(`\n${pass} lulus, ${fail} gagal`)
if (fail > 0) process.exit(1)
