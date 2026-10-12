import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	MineJobPayload,
	MinerWorkerRequest,
	MinerWorkerResponse,
} from '@/workers/miner.worker'

export interface MineProgress {
	hashes: number
	hashrate: number
	nonce: number
}

export type MineOutcome =
	| {
			kind: 'solution'
			nonce: number
			hash: string
			hashes: number
			elapsedMs: number
	  }
	| { kind: 'expired'; hashes: number; elapsedMs: number }
	| { kind: 'stopped'; hashes: number; elapsedMs: number }

interface PendingJob {
	resolve: (outcome: MineOutcome) => void
	/** Akumulasi hash seluruh worker untuk laporan progres gabungan. */
	onProgress?: (progress: MineProgress) => void
}

const createId = (): string =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Jumlah worker PoW.
 *
 * Dipilih dari `navigator.hardwareConcurrency`, tetapi DIBATASI ke angka
 * aman: pengukuran lapangan (i3-6100, 2 core) menunjukkan throughput
 * saturasi di 2–3 worker dan MULAI TURUN setelahnya (kontensi + alokasi
 * hasher per-hash). Karena itu diclamp ke maksimum 4, dan konfigurasi
 * runtime (localStorage `nex_miner_workers`) boleh menimpanya.
 */
const MAX_WORKERS = 4

const resolveWorkerCount = (): number => {
	// override eksplisit (untuk eksperimen / mesin khusus)
	try {
		const raw = localStorage.getItem('nex_miner_workers')
		if (raw) {
			const parsed = Number.parseInt(raw, 10)
			if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 32) {
				return parsed
			}
		}
	} catch {
		// localStorage bisa diblokir — abaikan, jatuh ke default.
	}
	const hc =
		typeof navigator !== 'undefined' && navigator.hardwareConcurrency
			? navigator.hardwareConcurrency
			: 2
	return Math.max(1, Math.min(MAX_WORKERS, hc))
}

/**
 * Siklus hidup POOL Web Worker miner + protokol request/response.
 *
 * Beberapa worker berbagi SATU job: ruang nonce dipartisi dengan stride —
 * worker-i memulai di `i` dan melangkah `N`. Tidak ada tumpang tindih, tidak
 * ada koordinasi pusat, dan worker pertama yang menemukan solusi menang
 * (submit ke node tetap aman karena node memverifikasi ulang).
 *
 * Hanya SATU job berjalan pada satu waktu; main thread menunggu hasil
 * sebelum meminta job berikutnya.
 */
export const useMinerWorker = () => {
	const workersRef = useRef<Worker[]>([])
	const pendingRef = useRef<PendingJob | null>(null)
	const settledRef = useRef(false)
	/** Hash yang sudah dilaporkan tiap worker (untuk akumulasi progres). */
	const perWorkerHashesRef = useRef<number[]>([])
	const lastProgressAtRef = useRef(0)
	const [ready, setReady] = useState(false)
	const [workerCount, setWorkerCount] = useState(0)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const count = resolveWorkerCount()
		const workers: Worker[] = []
		let readyCount = 0

		const handleMessage = (index: number, message: MinerWorkerResponse) => {
			if (!message) return

			if (message.type === 'READY') {
				readyCount++
				if (readyCount === count) setReady(true)
				return
			}

			const pending = pendingRef.current
			if (!pending) return

			if (message.type === 'PROGRESS') {
				perWorkerHashesRef.current[index] = message.hashes
				const now = Date.now()
				// Throttle: gabungkan laporan N worker jadi satu update UI.
				if (now - lastProgressAtRef.current < 300) return
				lastProgressAtRef.current = now
				const total = perWorkerHashesRef.current.reduce((a, b) => a + b, 0)
				pending.onProgress?.({
					hashes: total,
					hashrate: message.hashrate * count,
					nonce: message.nonce,
				})
				return
			}

			// RESULT / EXPIRED / STOPPED = terminal. Worker pertama menang.
			if (settledRef.current) return
			settledRef.current = true
			pendingRef.current = null

			// Hentikan sisa worker supaya tidak membuang CPU.
			for (const w of workersRef.current) {
				const stopMsg: MinerWorkerRequest = { id: createId(), type: 'STOP' }
				w.postMessage(stopMsg)
			}

			if (message.type === 'RESULT') {
				pending.resolve({
					kind: 'solution',
					nonce: message.nonce,
					hash: message.hash,
					hashes: message.hashes,
					elapsedMs: message.elapsedMs,
				})
			} else if (message.type === 'EXPIRED') {
				pending.resolve({
					kind: 'expired',
					hashes: message.hashes,
					elapsedMs: message.elapsedMs,
				})
			} else {
				pending.resolve({
					kind: 'stopped',
					hashes: message.hashes,
					elapsedMs: message.elapsedMs,
				})
			}
		}

		for (let i = 0; i < count; i++) {
			const worker = new Worker(
				new URL('../workers/miner.worker.ts', import.meta.url),
				{ type: 'module' },
			)
			worker.onmessage = (event: MessageEvent<MinerWorkerResponse>) =>
				handleMessage(i, event.data)
			worker.onerror = (event) => {
				setError(event.message || 'Worker error')
				const pending = pendingRef.current
				if (pending && !settledRef.current) {
					settledRef.current = true
					pendingRef.current = null
					pending.resolve({ kind: 'stopped', hashes: 0, elapsedMs: 0 })
				}
			}
			workers.push(worker)
		}

		workersRef.current = workers
		setWorkerCount(count)

		return () => {
			for (const w of workers) w.terminate()
			workersRef.current = []
			pendingRef.current = null
			setReady(false)
			setWorkerCount(0)
		}
	}, [])

	/** Jalankan satu job sampai solusi / kedaluwarsa / dihentikan. */
	const mine = useCallback(
		(
			job: MineJobPayload,
			onProgress?: (progress: MineProgress) => void,
		): Promise<MineOutcome> =>
			new Promise<MineOutcome>((resolve) => {
				const workers = workersRef.current
				if (workers.length === 0) {
					resolve({ kind: 'stopped', hashes: 0, elapsedMs: 0 })
					return
				}
				settledRef.current = false
				perWorkerHashesRef.current = new Array(workers.length).fill(0)
				lastProgressAtRef.current = 0
				pendingRef.current = onProgress ? { resolve, onProgress } : { resolve }

				// Partisi ruang nonce: worker-i mulai di i, melangkah N.
				const stride = workers.length
				for (let i = 0; i < workers.length; i++) {
					const message: MinerWorkerRequest = {
						id: createId(),
						type: 'MINE',
						payload: { ...job, startNonce: i, nonceStride: stride },
					}
					workers[i].postMessage(message)
				}
			}),
		[],
	)

	/** Minta semua worker berhenti pada batas potongan hash berikutnya. */
	const stop = useCallback(() => {
		for (const w of workersRef.current) {
			const message: MinerWorkerRequest = { id: createId(), type: 'STOP' }
			w.postMessage(message)
		}
	}, [])

	return { ready, error, workerCount, mine, stop }
}
