/**
 * Miner Web Worker — loop Proof-of-Work di luar main thread.
 *
 * Kenapa worker: loop PoW menghitung ribuan SHA-256 per potongan secara
 * SINKRON. Bila dijalankan di main thread, seluruh tab React membeku
 * (spinner berhenti, tombol Stop tidak bisa diklik). Worker memisahkan
 * komputasi dari UI — persis pola `crypto.worker.ts` di wallet-ui.
 *
 * PENTING — aturan konsensus diimpor dari modul KANONIK node, bukan
 * disalin:
 *   - `hashWithNonce`  (src/core/consensus/Pow)      → SHA-256(payload‖nonce)
 *   - `meetsDifficulty`(src/core/consensus/difficulty)
 * Keduanya murni (js-sha256, tanpa Node API) sehingga aman di browser dan
 * hasilnya identik dengan yang diverifikasi node saat `nex_submitWork`.
 * Node tetap memverifikasi ulang — worker ini tidak bisa memanipulasi apa pun.
 */
import { hashWithNonce } from 'src/core/consensus/Pow'
import { meetsDifficulty } from 'src/core/consensus/difficulty'

/** Potongan hash per iterasi — cukup besar untuk throughput, cukup kecil
 *  agar pesan STOP & pengecekan expiry tetap responsif. */
const HASH_CHUNK = 25_000
/** Interval minimal antar laporan progres (ms) — menjaga main thread santai. */
const PROGRESS_INTERVAL_MS = 400

export interface MineJobPayload {
	payload: string
	difficulty: number
	expiresAt: number
	startNonce?: number
}

export type MinerWorkerRequest =
	| { id: string; type: 'MINE'; payload: MineJobPayload }
	| { id: string; type: 'STOP' }

export type MinerWorkerResponse =
	| { id: string; type: 'PROGRESS'; hashes: number; hashrate: number; nonce: number }
	| {
			id: string
			type: 'RESULT'
			nonce: number
			hash: string
			hashes: number
			elapsedMs: number
	  }
	| { id: string; type: 'EXPIRED'; hashes: number; elapsedMs: number }
	| { id: string; type: 'STOPPED'; hashes: number; elapsedMs: number }
	| { type: 'READY' }

/**
 * `self` di worker punya tipe DedicatedWorkerGlobalScope. Kita tidak
 * menambahkan lib "WebWorker" ke tsconfig (bentrok dengan lib "DOM"),
 * jadi konteksnya di-cast minimal ke bentuk yang dipakai.
 */
const ctx = self as unknown as {
	postMessage: (message: MinerWorkerResponse) => void
	onmessage: ((event: MessageEvent<MinerWorkerRequest>) => void) | null
}

/**
 * Token job: setiap MINE/STOP menaikkannya. Loop yang token-nya sudah usang
 * berhenti sendiri, sehingga dua loop tidak pernah berjalan bersamaan.
 */
let currentToken = 0
let stopRequested = false

/** Beri kesempatan event loop memproses pesan STOP di antara potongan. */
const yieldToEventLoop = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0))

const runJob = async (
	token: number,
	id: string,
	job: MineJobPayload,
): Promise<void> => {
	const startedAt = Date.now()
	let nonce = job.startNonce ?? 0
	let hashes = 0
	let lastProgressAt = startedAt

	while (token === currentToken) {
		if (Date.now() >= job.expiresAt) {
			ctx.postMessage({
				id,
				type: 'EXPIRED',
				hashes,
				elapsedMs: Date.now() - startedAt,
			})
			return
		}

		const chunkEnd = nonce + HASH_CHUNK
		for (; nonce < chunkEnd; nonce++) {
			hashes++
			const hash = hashWithNonce(job.payload, nonce)
			if (meetsDifficulty(hash, job.difficulty)) {
				ctx.postMessage({
					id,
					type: 'RESULT',
					nonce,
					hash,
					hashes,
					elapsedMs: Date.now() - startedAt,
				})
				return
			}
		}

		const now = Date.now()
		if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
			lastProgressAt = now
			const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001)
			ctx.postMessage({
				id,
				type: 'PROGRESS',
				hashes,
				hashrate: hashes / elapsedSeconds,
				nonce,
			})
		}

		await yieldToEventLoop()
	}

	// Keluar karena token berubah. Bila penyebabnya STOP, laporkan;
	// bila karena digantikan job baru, diam saja (job baru yang melapor).
	if (stopRequested) {
		ctx.postMessage({
			id,
			type: 'STOPPED',
			hashes,
			elapsedMs: Date.now() - startedAt,
		})
	}
}

ctx.onmessage = (event: MessageEvent<MinerWorkerRequest>) => {
	const message = event.data
	if (!message) return

	if (message.type === 'STOP') {
		stopRequested = true
		currentToken++
		return
	}

	if (message.type === 'MINE') {
		stopRequested = false
		const token = ++currentToken
		void runJob(token, message.id, message.payload)
	}
}

ctx.postMessage({ type: 'READY' })
