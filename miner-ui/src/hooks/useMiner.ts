import { useCallback, useEffect, useRef, useState } from 'react'
import {
	getAccount,
	getChainId,
	getRecentBlocks,
	getWork,
	submitWork,
} from '@/lib/rpc'
import type { MiningJob, WorkResponse } from '@/lib/rpc'
import { errorMessage, formatDuration, shortHash } from '@/lib/format'
import { useMinerWorker } from './useMinerWorker'

export type MinerStatus =
	| 'idle'
	| 'connecting'
	| 'mining'
	| 'submitting'
	| 'retrying'

export interface FoundBlock {
	height: number
	hash: string
	difficulty: number
	nonce: number
	elapsedMs: number
	at: number
	accepted: boolean
	error?: string
}

export interface LogEntry {
	id: number
	at: number
	level: 'info' | 'success' | 'warn' | 'error'
	message: string
}

const RETRY_DELAY_MS = 3_000
const TIP_POLL_MS = 6_000
const BALANCE_POLL_MS = 15_000
const MAX_LOG = 200
const MAX_BLOCKS = 50

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

/** Validasi respons `nex_getWork` → job siap-hash, atau alasan penolakan. */
const toMiningJob = (
	response: WorkResponse,
): { job: MiningJob } | { reason: string } => {
	if (
		!response.status ||
		!response.jobId ||
		!response.payload ||
		response.difficulty === undefined ||
		response.height === undefined ||
		response.expiresAt === undefined
	) {
		return {
			reason:
				response.status === false
					? (response.error ?? 'respons tidak lengkap')
					: 'respons tidak lengkap',
		}
	}
	return {
		job: {
			jobId: response.jobId,
			payload: response.payload,
			difficulty: response.difficulty,
			height: response.height,
			previousBlockHash: response.previousBlockHash ?? '',
			expiresAt: response.expiresAt,
		},
	}
}

/**
 * Orkestrasi mining di main thread.
 *
 * Loop-nya adalah salinan setia alur `apps/miner/miner.ts`:
 *   getWork → hash di worker → submitWork → ulangi.
 *
 * Yang berubah hanya tempat: RPC + state UI di sini, komputasi hash di
 * Web Worker (`useMinerWorker`). Semua keputusan konsensus tetap di node.
 */
export const useMiner = () => {
	const { ready, error: workerError, mine, stop: stopWorker } = useMinerWorker()

	const [status, setStatus] = useState<MinerStatus>('idle')
	const [running, setRunning] = useState(false)
	const [stopping, setStopping] = useState(false)
	const [address, setAddress] = useState('')
	const [connected, setConnected] = useState(false)
	const [chainId, setChainId] = useState<number | null>(null)
	const [tipHeight, setTipHeight] = useState<number | null>(null)
	const [balanceNexu, setBalanceNexu] = useState(0)
	const [hashrate, setHashrate] = useState(0)
	const [currentHashes, setCurrentHashes] = useState(0)
	const [currentNonce, setCurrentNonce] = useState(0)
	const [totalHashes, setTotalHashes] = useState(0)
	const [currentJob, setCurrentJob] = useState<MiningJob | null>(null)
	const [blocksFound, setBlocksFound] = useState<FoundBlock[]>([])
	const [log, setLog] = useState<LogEntry[]>([])
	const [now, setNow] = useState(() => Date.now())

	const runningRef = useRef(false)
	const addressRef = useRef('')
	const totalHashesRef = useRef(0)
	const logIdRef = useRef(0)

	const pushLog = useCallback(
		(level: LogEntry['level'], message: string) => {
			logIdRef.current += 1
			const entry: LogEntry = {
				id: logIdRef.current,
				at: Date.now(),
				level,
				message,
			}
			setLog((prev) => [entry, ...prev].slice(0, MAX_LOG))
		},
		[],
	)

	const refreshBalance = useCallback(async () => {
		const addr = addressRef.current
		if (!addr) return
		try {
			const account = await getAccount(addr)
			setBalanceNexu(account?.balance ?? 0)
		} catch {
			// Saldo gagal dibaca bukan alasan menghentikan mining.
		}
	}, [])

	const refreshTip = useCallback(async () => {
		try {
			const [blocks, id] = await Promise.all([
				getRecentBlocks(1),
				getChainId(),
			])
			setTipHeight(blocks[0]?.height ?? null)
			if (typeof id === 'number') setChainId(id)
			setConnected(true)
		} catch {
			setConnected(false)
		}
	}, [])

	const runLoop = useCallback(async () => {
		const minerAddress = addressRef.current

		while (runningRef.current) {
			// ---- 1. minta job -------------------------------------------
			setStatus('connecting')
			let job: MiningJob
			try {
				const parsed = toMiningJob(await getWork(minerAddress))
				if ('reason' in parsed) {
					pushLog(
						'warn',
						`getWork ditolak: ${parsed.reason} — coba lagi ${RETRY_DELAY_MS / 1000}s`,
					)
					setStatus('retrying')
					await delay(RETRY_DELAY_MS)
					continue
				}
				job = parsed.job
			} catch (error) {
				pushLog(
					'error',
					`RPC tidak terjangkau (${errorMessage(error)}) — coba lagi ${RETRY_DELAY_MS / 1000}s`,
				)
				setStatus('retrying')
				await delay(RETRY_DELAY_MS)
				continue
			}
			if (!runningRef.current) break

			setCurrentJob(job)
			setCurrentHashes(0)
			setCurrentNonce(0)
			setHashrate(0)
			setNow(Date.now())
			pushLog(
				'info',
				`Job ${job.jobId} · height #${job.height} · difficulty ${job.difficulty} bits`,
			)
			setStatus('mining')

			// ---- 2. cari nonce di worker ---------------------------------
			const outcome = await mine(
				{
					payload: job.payload,
					difficulty: job.difficulty,
					expiresAt: job.expiresAt,
				},
				(progress) => {
					setHashrate(progress.hashrate)
					setCurrentHashes(progress.hashes)
					setCurrentNonce(progress.nonce)
				},
			)

			totalHashesRef.current += outcome.hashes
			setTotalHashes(totalHashesRef.current)
			setCurrentHashes(0)
			setCurrentNonce(0)
			setHashrate(0)

			if (!runningRef.current || outcome.kind === 'stopped') break

			if (outcome.kind === 'expired') {
				pushLog('warn', 'Job kedaluwarsa tanpa solusi — minta job baru')
				continue
			}

			// ---- 3. submit -----------------------------------------------
			setStatus('submitting')
			pushLog(
				'info',
				`Solusi nonce ${outcome.nonce} (${formatDuration(outcome.elapsedMs)}) — submit…`,
			)
			try {
				const submitted = await submitWork(
					job.jobId,
					outcome.nonce,
					outcome.hash,
				)
				if (submitted.status && submitted.height !== undefined) {
					const block: FoundBlock = {
						height: submitted.height,
						hash: submitted.hash ?? outcome.hash,
						difficulty: submitted.difficulty ?? job.difficulty,
						nonce: outcome.nonce,
						elapsedMs: outcome.elapsedMs,
						at: Date.now(),
						accepted: true,
					}
					setBlocksFound((prev) => [block, ...prev].slice(0, MAX_BLOCKS))
					pushLog(
						'success',
						`Blok #${submitted.height} DITERIMA — ${shortHash(block.hash)}`,
					)
					void refreshTip()
					void refreshBalance()
				} else {
					const block: FoundBlock = {
						height: job.height,
						hash: outcome.hash,
						difficulty: job.difficulty,
						nonce: outcome.nonce,
						elapsedMs: outcome.elapsedMs,
						at: Date.now(),
						accepted: false,
						error: submitted.error ?? 'ditolak',
					}
					setBlocksFound((prev) => [block, ...prev].slice(0, MAX_BLOCKS))
					pushLog(
						'warn',
						`Submit ditolak: ${submitted.error ?? 'unknown'} — ambil job baru`,
					)
				}
			} catch (error) {
				pushLog(
					'error',
					`Submit gagal: ${errorMessage(error)} — ambil job baru`,
				)
			}
			// ---- 4. ulangi: blok sudah bergerak, job lama pasti basi ------
		}

		setStatus('idle')
		setCurrentJob(null)
		setCurrentHashes(0)
		setCurrentNonce(0)
		setHashrate(0)
		setRunning(false)
		setStopping(false)
	}, [mine, pushLog, refreshBalance, refreshTip])

	const start = useCallback(
		(minerAddress: string) => {
			if (runningRef.current) return
			addressRef.current = minerAddress
			setAddress(minerAddress)
			totalHashesRef.current = 0
			setTotalHashes(0)
			setBlocksFound([])
			setStopping(false)
			setRunning(true)
			runningRef.current = true
			pushLog('info', `Miner dimulai — hadiah ke ${minerAddress}`)
			void runLoop()
		},
		[pushLog, runLoop],
	)

	const stop = useCallback(() => {
		if (!runningRef.current) return
		runningRef.current = false
		setStopping(true)
		pushLog('info', 'Menghentikan miner — menyelesaikan potongan hash…')
		stopWorker()
	}, [pushLog, stopWorker])

	// Polling tip & status koneksi.
	useEffect(() => {
		void refreshTip()
		const timer = window.setInterval(() => void refreshTip(), TIP_POLL_MS)
		return () => window.clearInterval(timer)
	}, [refreshTip])

	// Polling saldo hadiah (hanya bila alamat sudah diketahui).
	useEffect(() => {
		if (!address) return
		void refreshBalance()
		const timer = window.setInterval(
			() => void refreshBalance(),
			BALANCE_POLL_MS,
		)
		return () => window.clearInterval(timer)
	}, [address, refreshBalance])

	// Detak 1 detik untuk countdown kedaluwarsa job.
	useEffect(() => {
		if (!running) return
		const timer = window.setInterval(() => setNow(Date.now()), 1_000)
		return () => window.clearInterval(timer)
	}, [running])

	return {
		ready,
		workerError,
		status,
		running,
		stopping,
		address,
		connected,
		chainId,
		tipHeight,
		balanceNexu,
		hashrate,
		currentHashes,
		currentNonce,
		totalHashes,
		currentJob,
		blocksFound,
		log,
		now,
		start,
		stop,
	}
}
