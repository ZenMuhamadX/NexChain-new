/**
 * Benchmark PBKDF2 vault — dirancang TAHAN NOISE.
 *
 * Mesin uji hanya 2 core dan selalu ada proses lain yang rakus CPU, jadi
 * angka tunggal/median gampang tercemar. Karena itu:
 *   - semua konfigurasi dijalankan ROUND-ROBIN (bukan berurutan per blok),
 *     supaya drift beban CPU menyebar merata ke tiap konfigurasi;
 *   - nilai yang dilaporkan adalah MINIMUM tiap konfigurasi — minimum paling
 *     tahan terhadap interleaving, dan mendekati "waktu tanpa gangguan".
 *
 * Kandidat yang dibandingkan (semua dengan parameter IDENTIK dengan
 * Web Crypto: PBKDF2-HMAC-SHA256, 310.000 iterasi, 32 byte kunci):
 *   1. native  — crypto.subtle (hanya ada di origin aman / Node/Bun)
 *   2. noble sync — @noble/hashes tanpa yield (blokir main thread penuh)
 *   3. noble async @ beberapa asyncTick (yield = jeda supaya UI tetap jalan)
 *
 * Catatan: `hash-wasm` pernah ikut diukur di sini dan TERBUKTI lebih lambat
 * dari noble murni JS (1284 ms vs 854 ms pada run yang sama), sehingga
 * dependensi itu dihapus — jalurnya ikut dibuang dari benchmark ini agar
 * `package.json` tidak membawa paket yang tidak dipakai siapa pun.
 *
 * Jalankan: bun run scripts/vaultBench.ts
 */
import { pbkdf2, pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { KDF_ITERATIONS } from 'client/wallet/vaultCrypto'

const PASS = new TextEncoder().encode('passphrase-benchmark')
const SALT = new Uint8Array(16).fill(0xab)
const ITER = KDF_ITERATIONS
const DK = 32
const ROUNDS = 4

type Config = { label: string; run: () => unknown | Promise<unknown> }

/** crypto.subtle butuh CryptoKey — kunci identik dipakai agar adil. */
const subtleKey = await crypto.subtle.importKey(
	'raw',
	PASS,
	{ name: 'PBKDF2' },
	false,
	['deriveBits'],
)

const configs: Config[] = [
	{
		label: 'native WebCrypto (referensi)',
		run: () =>
			crypto.subtle.deriveBits(
				{ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: ITER },
				subtleKey,
				8 * DK,
			),
	},
	{
		label: 'noble sync (blokir penuh)',
		run: () => pbkdf2(sha256, PASS, SALT, { c: ITER, dkLen: DK }),
	},
	...[20, 100, 250].map((asyncTick) => ({
		label: `noble asyncTick=${asyncTick}`,
		run: () =>
			pbkdf2Async(sha256, PASS, SALT, { c: ITER, dkLen: DK, asyncTick }),
	})),
]

const best = new Map<string, number>(
	configs.map((c) => [c.label, Number.POSITIVE_INFINITY]),
)
const all = new Map<string, number[]>(configs.map((c) => [c.label, []]))

console.log(
	`\nPBKDF2-SHA256 ${ITER.toLocaleString('id-ID')} iterasi — round-robin ${ROUNDS}×, dilaporkan MINIMUM\n`,
)

// Pemanasan: JIT + inisialisasi WASM sekali sebelum pengukuran.
for (const config of configs) await config.run()

for (let round = 1; round <= ROUNDS; round++) {
	const line: string[] = []
	for (const config of configs) {
		const started = performance.now()
		await config.run()
		const ms = performance.now() - started
		all.get(config.label)!.push(ms)
		if (ms < best.get(config.label)!) best.set(config.label, ms)
		line.push(`${ms.toFixed(0)}`)
	}
	console.log(`  round ${round}: ${line.join('  ')}`)
}

const nativeBest = best.get(configs[0].label)!
console.log('\n  --- hasil (MINIMUM per konfigurasi) ---')
for (const config of configs) {
	const ms = best.get(config.label)!
	const speedup = ms / nativeBest
	console.log(
		`  ${config.label.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms` +
			`   ${speedup.toFixed(1)}× lebih lama dari native`,
	)
}

const syncBest = best.get(
	configs.find((c) => c.label.startsWith('noble sync'))!.label,
)!
console.log('\n  --- overhead yield (vs noble sync) ---')
for (const config of configs.filter((c) => c.label.includes('asyncTick'))) {
	const ms = best.get(config.label)!
	const tick = Number(config.label.split('=')[1])
	console.log(
		`  ${config.label.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms` +
			`   +${((ms / syncBest - 1) * 100).toFixed(0)}% (${(ms - syncBest).toFixed(0)} ms sia-sia untuk yield,` +
			` ±${Math.max(1, Math.ceil(syncBest / tick))} yield selama unlock)`,
	)
}

console.log('\n  --- semua run (untuk melihat sebaran noise) ---')
for (const [label, runs] of all) {
	console.log(
		`  ${label.padEnd(34)} ${runs.map((r) => r.toFixed(0)).join(' / ')} ms`,
	)
}
