/**
 * Klien miner **eksternal** — proses terpisah dari node.
 *
 * Prinsip kerja (inilah yang membuat RPC tetap hidup saat mining):
 *   1. `nex_getWork`      — minta job (payload + difficulty) via HTTP;
 *   2. loop hash in-process — SHA-256(payload || nonce) sampai lolos difficulty;
 *   3. `nex_submitWork`   — kirim solusi; node verifikasi ulang & commit blok;
 *   4. ulangi (job baru per blok; blok tiap ±30 detik sesuai target difficulty).
 *
 * Klien ini SENGAJA hanya mengimpor modul murni (`hashWithNonce`,
 * `meetsDifficulty`) — TIDAK ADA import LevelDB/model DB di sini, karena itu
 * justru yang dulu memaksa node berhenti saat mining (lock `base/` + freeze
 * event loop). Seluruh keputusan konsensus tetap di node.
 */
import { hashWithNonce } from 'src/core/consensus/Pow'
import {
	meetsDifficulty,
	TARGET_BLOCK_TIME_MS,
} from 'src/core/consensus/difficulty'

/** Endpoint — konsisten dengan client/rpc-client (env NEX_RPC_URL). */
const DEFAULT_RPC_URL = 'http://localhost:8000/rpc'
const resolveRpcUrl = (): string => {
	const env =
		typeof process !== 'undefined' ? process.env?.NEX_RPC_URL : undefined
	if (typeof env === 'string' && env.length > 0) {
		try {
			const url = new URL(env)
			if (url.protocol === 'http:' || url.protocol === 'https:') return env
		} catch {
			// bukan URL valid → pakai default
		}
	}
	return DEFAULT_RPC_URL
}
const RPC_URL = resolveRpcUrl()

/** Nonce dikerjakan per-potong supaya log hashrate & expiry job tetap terpantau. */
const HASH_CHUNK = 50_000
const HASHRATE_LOG_MS = 5_000
const RETRY_DELAY_MS = 3_000

// ---------------------------------------------------------------------------
// Tipe hasil RPC (longgar — sisi klien cukup membaca field yang dipakai)
// ---------------------------------------------------------------------------

interface WorkResponse {
	status: boolean
	jobId?: string
	payload?: string
	difficulty?: number
	height?: number
	expiresAt?: number
	error?: string
}

interface SubmitResponse {
	status: boolean
	height?: number
	hash?: string
	error?: string
}

interface Work {
	jobId: string
	payload: string
	difficulty: number
	height: number
	expiresAt: number
}

// ---------------------------------------------------------------------------
// Transport JSON-RPC (HTTP POST, tanpa dependensi apa pun)
// ---------------------------------------------------------------------------

let requestId = 0

const rpcCall = async <T>(method: string, params?: unknown): Promise<T> => {
	const response = await fetch(RPC_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++requestId,
			method,
			...(params === undefined ? {} : { params }),
		}),
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`)
	}
	const body = (await response.json()) as {
		result?: T
		error?: { code?: number; message?: string }
	}
	if (body.error) {
		throw new Error(body.error.message ?? `JSON-RPC error ${body.error.code}`)
	}
	return body.result as T
}

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

const formatHashrate = (hashesPerSecond: number): string =>
	hashesPerSecond >= 1_000_000
		? `${(hashesPerSecond / 1_000_000).toFixed(2)} MH/s`
		: `${(hashesPerSecond / 1_000).toFixed(1)} kH/s`

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

// ---------------------------------------------------------------------------
// Loop PoW
// ---------------------------------------------------------------------------

/**
 * Cari nonce untuk satu job. Sinkron per-potong (chunk) supaya hashrate
 * maksimal; di antara potongan flag `isRunning` & expiry job dicek, sehingga
 * Ctrl+C dan job kedaluwarsa tertangani dalam hitungan milidetik.
 *
 * @returns solusi, `null` bila job kedaluwarsa / miner dihentikan.
 */
const findSolution = (
	work: Work,
	isRunning: () => boolean,
	onProgress: (hashes: number) => void,
): { nonce: number; hash: string } | null => {
	let nonce = 0
	while (isRunning()) {
		if (Date.now() >= work.expiresAt) return null
		const chunkEnd = nonce + HASH_CHUNK
		for (; nonce < chunkEnd; nonce++) {
			const hash = hashWithNonce(work.payload, nonce)
			if (meetsDifficulty(hash, work.difficulty)) {
				return { nonce, hash }
			}
		}
		onProgress(HASH_CHUNK)
	}
	return null
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const runMiner = async (minerAddress: string): Promise<void> => {
	let running = true
	process.once('SIGINT', () => {
		running = false
		console.log('\nStopping miner — menyelesaikan potongan hash berjalan...')
	})

	console.log('NexChain external miner')
	console.log(`  address : ${minerAddress}`)
	console.log(`  rpc     : ${RPC_URL}`)
	console.log(`  target  : ±${TARGET_BLOCK_TIME_MS / 1000}s per blok`)

	let totalHashes = 0

	while (running) {
		// ---- 1. minta job ------------------------------------------------
		let work: Work
		try {
			const result = await rpcCall<WorkResponse>('nex_getWork', {
				minerAddress,
			})
			if (
				!result.status ||
				!result.jobId ||
				!result.payload ||
				result.difficulty === undefined ||
				result.height === undefined ||
				result.expiresAt === undefined
			) {
				console.error(
					`getWork ditolak: ${result.error ?? 'respons tidak lengkap'} — coba lagi dalam ${RETRY_DELAY_MS / 1000}s`,
				)
				await delay(RETRY_DELAY_MS)
				continue
			}
			work = {
				jobId: result.jobId,
				payload: result.payload,
				difficulty: result.difficulty,
				height: result.height,
				expiresAt: result.expiresAt,
			}
		} catch (error) {
			console.error(
				`RPC tidak terjangkau (${errorMessage(error)}) — coba lagi dalam ${RETRY_DELAY_MS / 1000}s`,
			)
			await delay(RETRY_DELAY_MS)
			continue
		}

		console.log(
			`Job ${work.jobId} | height #${work.height} | difficulty ${work.difficulty} bits`,
		)

		// ---- 2. cari nonce ----------------------------------------------
		const startedAt = Date.now()
		let jobHashes = 0
		let lastLog = startedAt
		const solution = findSolution(
			work,
			() => running,
			(count) => {
				jobHashes += count
				totalHashes += count
				const now = Date.now()
				if (now - lastLog >= HASHRATE_LOG_MS) {
					lastLog = now
					const rate = jobHashes / ((now - startedAt) / 1000)
					console.log(
						`  ... ${formatHashrate(rate)} (${jobHashes.toLocaleString()} hash)`,
					)
				}
			},
		)

		if (!solution) {
			if (!running) break
			console.log('Job kedaluwarsa tanpa solusi — minta job baru...')
			continue
		}

		const elapsed = (Date.now() - startedAt) / 1000
		const rate = jobHashes / Math.max(elapsed, 0.001)
		console.log(
			`Solusi: nonce ${solution.nonce}, hash ${solution.hash} ` +
				`(${elapsed.toFixed(1)}s @ ${formatHashrate(rate)}) — submit...`,
		)

		// ---- 3. submit ---------------------------------------------------
		try {
			const submitted = await rpcCall<SubmitResponse>('nex_submitWork', {
				jobId: work.jobId,
				nonce: solution.nonce,
				hash: solution.hash,
			})
			if (submitted.status) {
				console.log(`Blok #${submitted.height} DITERIMA: ${submitted.hash}\n`)
			} else {
				console.error(
					`Ditolak: ${submitted.error ?? 'unknown'} — ambil job baru...\n`,
				)
			}
		} catch (error) {
			console.error(
				`Submit gagal: ${errorMessage(error)} — ambil job baru...\n`,
			)
		}
		// ---- 4. ulangi: blok sudah bergerak, job lama pasti basi ----------
	}

	console.log(
		`Miner berhenti. Total ${totalHashes.toLocaleString()} hash dihitung.`,
	)
}
