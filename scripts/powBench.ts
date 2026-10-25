/**
 * Benchmark loop PoW — ALAT DIAGNOSTIK, bukan gate.
 *
 * Membandingkan:
 *   1. `hashWithNonce` (jalur lama: concat string tiap iterasi)
 *   2. `createPowHasher` (jalan baru: buffer-tetap)
 *   3. `meetsDifficulty` overhead (jalur lama vs baru dengan syarat lengkap)
 *
 * Lalu memberi SARAN jumlah worker untuk mesin ini berdasarkan skala worker
 * nyata (worker_threads) — berguna sebagai pembanding kasar sebelum menyetel
 * `--threads` di `apps/miner-rs/`.
 *
 * Jalankan:  bun run pow:bench
 */
import {
	Worker,
	isMainThread,
	parentPort,
	workerData,
} from 'node:worker_threads'
import { cpus } from 'node:os'
import { hashWithNonce, createPowHasher } from 'src/core/consensus/Pow'
import { meetsDifficulty } from 'src/core/consensus/difficulty'

const PAYLOAD = JSON.stringify({
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
})

const N = 2_000_000

// ---------------------------------------------------------------------------
// Jalur worker: satu worker menghitung rentang nonce dengan hasher cepat.
// ---------------------------------------------------------------------------

if (!isMainThread) {
	const { startNonce, stride, count } = workerData as {
		startNonce: number
		stride: number
		count: number
	}
	const hasher = createPowHasher(PAYLOAD)
	const t0 = Date.now()
	for (let i = 0, nonce = startNonce; i < count; i++, nonce += stride) {
		hasher.hash(nonce)
	}
	parentPort?.postMessage({ ms: Date.now() - t0, count })
} else {
	console.log('NexChain PoW benchmark\n')
	console.log(`payload  : ${PAYLOAD.length} chars`)
	console.log(`logical  : ${cpus().length} cpu(s)\n`)

	// ---- 1. jalur lama vs baru (single-thread, in-process) ----------------
	const bench = (label: string, fn: (n: number) => string): void => {
		for (let i = 0; i < 50_000; i++) fn(i) // warmup
		const t0 = Date.now()
		for (let i = 0; i < N; i++) fn(i)
		const ms = Date.now() - t0
		console.log(
			`  ${label.padEnd(30)} ${(N / (ms / 1000) / 1000).toFixed(1).padStart(8)} kH/s`,
		)
	}

	console.log('hash mentah (tanpa meetsDifficulty):')
	bench('hashWithNonce (lama)', (n) => hashWithNonce(PAYLOAD, n))
	const hasher = createPowHasher(PAYLOAD)
	bench('createPowHasher (baru)', (n) => hasher.hash(n))

	console.log('\ndengan meetsDifficulty(difficulty=20):')
	bench('hashWithNonce + cek', (n) => {
		const h = hashWithNonce(PAYLOAD, n)
		return meetsDifficulty(h, 20) ? 'y' : ''
	})
	const hasher2 = createPowHasher(PAYLOAD)
	bench('createPowHasher + cek', (n) => {
		const h = hasher2.hash(n)
		return meetsDifficulty(h, 20) ? 'y' : ''
	})

	// ---- 2. skala worker nyata -------------------------------------------
	console.log('\nskala worker (worker_threads, rentang nonce terpartisi):')

	const runWorkers = async (count: number): Promise<number> => {
		const per = Math.floor(1_500_000 / count)
		const results = await Promise.all(
			Array.from({ length: count }, (_, i) => {
				const w = new Worker(new URL(import.meta.url), {
					workerData: { startNonce: i, stride: count, count: per },
				})
				return new Promise<{ ms: number; count: number }>((resolve) => {
					w.on('message', (m) => {
						resolve(m)
						void w.terminate()
					})
				})
			}),
		)
		const wall = Math.max(...results.map((r) => r.ms))
		const total = results.reduce((a, r) => a + r.count, 0)
		return total / (wall / 1000)
	}

	const logical = cpus().length
	const candidates: number[] = []
	for (let c = 1; c <= Math.max(4, logical); c++) candidates.push(c)
	// selalu sertakan logical+1 untuk melihat apakah oversubscribe membantu
	if (!candidates.includes(logical + 1)) candidates.push(logical + 1)

	let best = { count: 1, rate: 0 }
	for (const c of candidates) {
		const rate = await runWorkers(c)
		console.log(
			`  ${String(c).padStart(2)} worker(s)  ${(rate / 1000).toFixed(1).padStart(8)} kH/s`,
		)
		if (rate > best.rate) best = { count: c, rate }
	}

	console.log(
		`\n  saran: ${best.count} worker (${(best.rate / 1000).toFixed(1)} kH/s pada mesin ini)`,
	)
	console.log(
		'\n  pembanding: `nex-miner --threads <n>` di apps/miner-rs/ memakai midstate,',
	)
	console.log(
		'  jadi angka absolutnya jauh lebih tinggi; yang relevan di sini skala thread.',
	)
}
