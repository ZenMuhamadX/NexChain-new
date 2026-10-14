import { MemPool } from 'src/core/transaction/memPool'
import { TxInterface } from 'src/types/transaction'
import { Block } from 'src/core/block/blockModel'
import { createBlockTemplate } from 'src/core/block/createBlockTemplate'
import { prepareBlockForHashing } from 'src/core/block/prepareBlock'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { getCurrentBlock } from 'src/core/block/query/onChain/block/getCurrentBlock'
import { isChainsValid } from 'src/core/block/isChainValid'
import { calculateSize } from 'src/core/encoding/lib/calculateSizeBytes'
import { hashWithNonce } from './Pow'
import { meetsDifficulty, TARGET_BLOCK_TIME_MS } from './difficulty'
import { createJob, getJob, deleteJob, pruneExpiredJobs } from './jobStore'
import { chains } from 'src/core/block/initBlock'
import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { mineLog } from 'src/logging/mineLog'
import { logToConsole } from 'src/logging/logging'
import { publishBlock } from 'src/core/events/nodeEvents'
import { isSyncing } from 'src/core/events/syncState'
import { loggingErr } from 'src/logging/errorLog'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { formatStr } from 'src/core/encoding/lib/formatString'
import { removeMemPool } from 'src/core/state/storage/mempool/removeMempool'
import { isTxExecuted } from 'src/core/transaction/isTxExecuted'

/**
 * Protokol job mining node ↔ miner eksternal (semua lewat JSON-RPC yang
 * sama — tidak perlu port/proses tambahan):
 *
 *   nex_getWork({minerAddress})
 *     → node verifikasi rantai, isi mempool, susun template (hadiah +
 *       coinbase + merkle + retarget difficulty), daftarkan job, kirim
 *       {jobId, payload, difficulty, height, ...} untuk di-hash miner.
 *   nex_submitWork({jobId, nonce, hash})
 *     → node verifikasi ULANG sha256(payload+nonce), difficulty, dan
 *       kesegaran tip; bila lolos, finalisasi (nonce/hash/size — blok
 *       produksi TIDAK ditandatangani siapa pun, standar PoW Bitcoin) dan
 *       commitBlock — hadiah terkredit lewat processTransact (coinbase).
 *
 * Node tidak pernah menghitung PoW sendiri; loop-nya ada di klien
 * (`client/miner/runMiner.ts`), sehingga LevelDB & event loop node bebas
 * dan RPC tetap melayani selama mining berlangsung.
 *
 * Node TIDAK memiliki wallet: `minerAddress` (penerima hadiah) WAJIB
 * dikirim miner pada `nex_getWork`. Hanya transaksi yang ditandatangani
 * (oleh pengirimnya) — lihat `nexchain/miner/verify/verifyIntegrity.ts`
 * untuk model verifikasi rantai (PoW + hash chain + merkle + struktur).
 *
 * KEDUA arah — `nex_getWork` (snapshot tip + mempool) dan `nex_submitWork`
 * (commit + bersihkan mempool) — dijalankan lewat satu antrean serial
 * `workQueue`. Tanpa itu, getWork bisa membaca mempool DI ANTARA
 * pemindahan tip dan penghapusan transaksi blok yang baru di-commit:
 * transaksi yang sudah masuk blok N tertangkap lagi, ikut template N+1,
 * lolos semua verifikasi (merkle per-blok), dan dieksekusi dua kali
 * (kredit ganda ke penerima).
 */

// ---------------------------------------------------------------------------
// Tipe hasil
// ---------------------------------------------------------------------------

export interface WorkOk {
	status: true
	jobId: string
	/** Preimage PoW — miner mencari nonce agar sha256(payload+nonce) lolos. */
	payload: string
	difficulty: number
	height: number
	previousBlockHash: string
	minerAddress: string
	/** Tanggal kedaluwarsa job (epoch ms) — miner minta ulang setelah ini. */
	expiresAt: number
	targetBlockTimeMs: number
}
export interface WorkErr {
	status: false
	error: string
}
export type WorkResult = WorkOk | WorkErr

export interface SubmitOk {
	status: true
	height: number
	hash: string
	difficulty: number
	minerAddress: string
}
export interface SubmitErr {
	status: false
	error: string
}
export type SubmitResult = SubmitOk | SubmitErr

// ---------------------------------------------------------------------------
// Normalisasi params (JSON-RPC menerima objek maupun array posisional)
// ---------------------------------------------------------------------------

const firstParam = (raw: unknown): unknown =>
	Array.isArray(raw) ? raw[0] : raw

const parseMinerAddress = (raw: unknown): string | undefined => {
	const value = firstParam(raw)
	if (typeof value === 'string') return value
	if (value !== null && typeof value === 'object') {
		const address = (value as Record<string, unknown>).minerAddress
		if (typeof address === 'string') return address
	}
	return undefined
}

interface ParsedSubmit {
	jobId: string
	nonce: number
	hash: string
}

const parseSubmit = (raw: unknown): ParsedSubmit | undefined => {
	const value = firstParam(raw)
	if (value === null || typeof value !== 'object') return undefined
	const record = value as Record<string, unknown>
	const { jobId, nonce, hash } = record
	if (typeof jobId !== 'string' || jobId.length === 0) return undefined
	if (typeof nonce !== 'number' || !Number.isSafeInteger(nonce) || nonce < 0) {
		return undefined
	}
	if (typeof hash !== 'string' || hash.length !== 64) return undefined
	return { jobId, nonce, hash }
}

// ---------------------------------------------------------------------------
// nex_getWork — lewat antrean serial (lihat workQueue)
// ---------------------------------------------------------------------------

/**
 * Antrean serial SATU untuk getWork & submitWork.
 *
 * Snapshot (baca tip + loadMempool + susun template) dan commit (simpan
 * blok + processTransact + removeMemPool) tidak boleh berjalan bersamaan —
 * lihat catatan race di komentar modul. Dua miner yang sama-sama menyelesaikan
 * job height yang sama juga teratasi di sini: submit dijalankan satu per
 * satu; saat giliran kedua tiba, cek tip menolaknya → "Stale job".
 *
 * Task disimpan dalam keadaan sudah di-catch (`workQueue = running.catch`)
 * sehingga satu kegagalan tidak mematikan antrean berikutnya; flag/queue
 * di-set sinkron SEBELUM await pertama.
 */
let workQueue: Promise<unknown> = Promise.resolve()

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
	const running = workQueue.then(task)
	workQueue = running.catch(() => undefined)
	return running
}

export const getWork = (rawParams?: unknown): Promise<WorkResult> =>
	enqueue(() => executeGetWork(rawParams))

const executeGetWork = async (rawParams?: unknown): Promise<WorkResult> => {
	try {
		// Gerbang IBD: JANGAN menyusun template di atas rantai yang masih
		// tertinggal. Tanpa ini, node yang baru menyambung ke jaringan bisa
		// menambang di atas tip lokal yang basi → rantai bercabang yang TIDAK
		// bisa di-reorg (reorg belum didukung, lihat `src/p2p/`). Gerbang hanya
		// menyala saat P2P menandai "syncing"; node tunggal (P2P mati) dan node
		// yang sudah menyusul tidak pernah terpengaruh — lihat
		// `src/core/events/syncState.ts`.
		//
		// CATATAN: hanya `nex_getWork` yang digerbang. `nex_submitWork` dan
		// `connectBlock` TIDAK — kerja yang sudah dihitung miner tetap bisa
		// diselesaikan, dan blok yang datang dari peer tetap di-commit.
		if (isSyncing()) {
			return {
				status: false,
				error:
					'Node is syncing with peers (IBD in progress) — mining is ' +
					'paused until the chain catches up. See nex_getSyncStatus.',
			}
		}

		const genesis = await getBlockByHeight(0, 'json')
		if (!genesis) {
			return {
				status: false,
				error:
					'Genesis block not found — buat genesis dulu (auto saat RPC boot)',
			}
		}

		// Alamat penerima hadiah WAJIB dari miner — node tidak punya wallet
		// (mining sepenuhnya eksternal & keyless, lihat komentar modul).
		const provided = parseMinerAddress(rawParams)
		if (!provided) {
			return {
				status: false,
				error:
					'minerAddress required — kirim {minerAddress} (alamat penerima hadiah)',
			}
		}
		if (!isValidAddress(provided)) {
			return {
				status: false,
				error: `Invalid miner address: ${formatStr(provided)}`,
			}
		}
		const minerAddress = provided

		// Jangan membangun di atas rantai yang rusak: integrity check kini
		// benar-benar memeriksa hasil (verifyStruct await, PoW, hash chain,
		// merkle, genesis hash) — lihat verify/verifyIntegrity.
		if (!(await isChainsValid())) {
			return {
				status: false,
				error:
					'Chain integrity check failed — periksa log node sebelum melanjutkan mining',
			}
		}

		// Buang job kadaluarsa LEBIH AWAL (membebaskan slot MAX_JOBS sebelum
		// job baru dibuat). Sejak M0 difficulty TIDAK lagi diambil dari jalur
		// expiry: retarget kini deterministik lewat `expectedDifficulty`
		// (berbasis timestamp blok), jadi prune murni untuk memori.
		pruneExpiredJobs()

		const pool = new MemPool()
		const loaded = await pool.getValidTransactions()
		// Penjaga "zombie": buang tx yang history-nya sudah 'confirmed'
		// (pernah dieksekusi — sisa crash antara saveTxHistory dan
		// removeMemPool, atau artefak race lama) dan bersihkan dari mempool,
		// supaya tidak terbawa ke blok berikutnya.
		const transactions: TxInterface[] = []
		for (const tx of loaded) {
			if (tx.txHash && (await isTxExecuted(tx.txHash))) {
				removeMemPool(tx.txHash)
				continue
			}
			transactions.push(tx)
		}
		const template = await createBlockTemplate(transactions, minerAddress)
		const payload = prepareBlockForHashing(template)

		const job = createJob({
			block: template,
			payload,
			difficulty: template.block.header.difficulty,
			height: template.block.height,
			previousBlockHash: template.block.header.previousBlockHash,
			minerAddress,
		})

		logToConsole(
			`Work ${job.jobId} → height ${job.height}, difficulty ${job.difficulty} bits, ` +
				`${transactions.length} tx, miner ${formatStr(minerAddress)}`,
		)

		return {
			status: true,
			jobId: job.jobId,
			payload,
			difficulty: job.difficulty,
			height: job.height,
			previousBlockHash: job.previousBlockHash,
			minerAddress,
			expiresAt: job.expiresAt,
			targetBlockTimeMs: TARGET_BLOCK_TIME_MS,
		}
	} catch (error) {
		loggingErr({
			message: error instanceof Error ? error.message : 'Unknown error',
			context: 'nex_getWork',
			level: 'error',
			priority: 'high',
			timestamp: generateTimestampz(),
			hint: 'Error building mining job',
			stack: new Error().stack!,
		})
		return {
			status: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
	}
}

// ---------------------------------------------------------------------------
// nex_submitWork
// ---------------------------------------------------------------------------

/**
 * Submit melewati antrean yang sama dengan getWork (`workQueue` di atas):
 * cek tip → commit berjalan SATU per SATU dan tidak pernah berbarengan
 * dengan pembuatan snapshot di getWork.
 */
export const submitWork = (rawParams?: unknown): Promise<SubmitResult> =>
	enqueue(() => executeSubmit(rawParams))

const executeSubmit = async (rawParams?: unknown): Promise<SubmitResult> => {
	try {
		const parsed = parseSubmit(rawParams)
		if (!parsed) {
			return {
				status: false,
				error: 'Invalid params: expected {jobId, nonce, hash}',
			}
		}
		const { jobId, nonce, hash } = parsed

		const job = getJob(jobId)
		if (!job) {
			return {
				status: false,
				error: 'Job not found or expired — minta job baru (nex_getWork)',
			}
		}

		// Job basi: tip sudah bergerak (miner lain menang / blok lain masuk).
		// Dilakukan DALAM queue serial sehingga tidak mungkin balapan.
		const tip = (await getCurrentBlock('json')) as Block
		if (
			tip.block.header.hash !== job.previousBlockHash ||
			tip.block.height !== job.height - 1
		) {
			deleteJob(jobId)
			return {
				status: false,
				error: `Stale job: chain tip sudah height ${tip.block.height}, job untuk ${job.height}`,
			}
		}

		// Verifikasi ulang PoW di sisi node — jangan percaya hash miner.
		const recomputed = hashWithNonce(job.payload, nonce)
		if (recomputed !== hash) {
			return { status: false, error: 'Hash does not match payload+nonce' }
		}
		if (!meetsDifficulty(hash, job.difficulty)) {
			return {
				status: false,
				error: `Hash does not meet difficulty ${job.difficulty} bits`,
			}
		}

		// Finalisasi: isi field yang tidak ikut preimage PoW. Blok produksi
		// TIDAK ditandatangani siapa pun (setara `sign` dihapus dari struktur
		// blok) — keamanan dari PoW + hash chain + merkle (verifyIntegrity).
		const block = job.block
		block.block.header.nonce = nonce
		block.block.header.hash = hash
		// size dihitung terakhir — tidak ikut preimage.
		block.block.size = calculateSize(block.block).KB

		const committed = await chains.commitBlock(block)
		deleteJob(jobId)

		if (!committed.status || !committed.block) {
			return { status: false, error: 'commitBlock failed — periksa log node' }
		}

		mineLog(block)
		logToConsole(
			`Block #${job.height} ${formatStr(hash)} committed ` +
				`(difficulty ${job.difficulty} bits, ${block.block.transactions.length} tx, ` +
				`miner ${job.minerAddress})`,
		)

		// Sebarkan blok hasil mining ke jaringan lewat bus netral. Core tidak
		// tahu-menahu soal P2P; `src/p2p/node.ts` yang berlangganan. Tanpa
		// pendengar (P2P mati) pemanggilan ini no-op.
		publishBlock(block)

		return {
			status: true,
			height: job.height,
			hash,
			difficulty: job.difficulty,
			minerAddress: job.minerAddress,
		}
	} catch (error) {
		loggingErr({
			message: error instanceof Error ? error.message : 'Unknown error',
			context: 'nex_submitWork',
			level: 'error',
			priority: 'high',
			timestamp: generateTimestampz(),
			hint: 'Error verifying/committing submitted work',
			stack: new Error().stack!,
		})
		return {
			status: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
	}
}
