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
	onProgress?: (progress: MineProgress) => void
}

const createId = (): string =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Siklus hidup satu Web Worker miner + protokol request/response.
 *
 * Hanya SATU job berjalan pada satu waktu (slot tunggal `pendingRef`),
 * sesuai keputusan desain "1 worker dulu": main thread menunggu hasil
 * sebelum meminta job berikutnya.
 */
export const useMinerWorker = () => {
	const workerRef = useRef<Worker | null>(null)
	const pendingRef = useRef<PendingJob | null>(null)
	const [ready, setReady] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const worker = new Worker(
			new URL('../workers/miner.worker.ts', import.meta.url),
			{ type: 'module' },
		)
		workerRef.current = worker

		worker.onmessage = (event: MessageEvent<MinerWorkerResponse>) => {
			const message = event.data
			if (!message) return

			if (message.type === 'READY') {
				setReady(true)
				return
			}

			const pending = pendingRef.current
			if (!pending) return

			if (message.type === 'PROGRESS') {
				pending.onProgress?.({
					hashes: message.hashes,
					hashrate: message.hashrate,
					nonce: message.nonce,
				})
				return
			}

			pendingRef.current = null
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

		worker.onerror = (event) => {
			setError(event.message || 'Worker error')
			const pending = pendingRef.current
			if (pending) {
				pendingRef.current = null
				pending.resolve({ kind: 'stopped', hashes: 0, elapsedMs: 0 })
			}
		}

		return () => {
			worker.terminate()
			workerRef.current = null
			pendingRef.current = null
			setReady(false)
		}
	}, [])

	/** Jalankan satu job sampai solusi / kedaluwarsa / dihentikan. */
	const mine = useCallback(
		(
			job: MineJobPayload,
			onProgress?: (progress: MineProgress) => void,
		): Promise<MineOutcome> =>
			new Promise<MineOutcome>((resolve) => {
				const worker = workerRef.current
				if (!worker) {
					resolve({ kind: 'stopped', hashes: 0, elapsedMs: 0 })
					return
				}
				pendingRef.current = onProgress
					? { resolve, onProgress }
					: { resolve }
				const message: MinerWorkerRequest = {
					id: createId(),
					type: 'MINE',
					payload: job,
				}
				worker.postMessage(message)
			}),
		[],
	)

	/** Minta worker berhenti pada batas potongan hash berikutnya. */
	const stop = useCallback(() => {
		const message: MinerWorkerRequest = { id: createId(), type: 'STOP' }
		workerRef.current?.postMessage(message)
	}, [])

	return { ready, error, mine, stop }
}
