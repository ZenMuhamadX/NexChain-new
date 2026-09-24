import { MemPool } from '../model/memPool/memPool'
import { TxInterface } from 'interface/structTx'
import { Block } from 'nexchain/model/block/block'
import { createBlockTemplate } from 'nexchain/block/createBlockTemplate'
import { prepareBlockForHashing } from 'nexchain/block/prepareBlock'
import { getBlockByHeight } from 'nexchain/block/query/onChain/block/getBlockByHeight'
import { getCurrentBlock } from 'nexchain/block/query/onChain/block/getCurrentBlock'
import { isChainsValid } from 'nexchain/block/isChainValid'
import { calculateSize } from 'nexchain/lib/calculateSize'
import { hashWithNonce } from './Pow'
import { meetsDifficulty, TARGET_BLOCK_TIME_MS } from './difficulty'
import { createJob, getJob, deleteJob, cleanupExpiredJobs } from './jobStore'
import { chains } from 'nexchain/block/initBlock'
import { getLastBlockTimestamp } from 'nexchain/blockchain/blockchain'
import { isValidAddress } from 'nexchain/transaction/utils/isValidAddress'
import { getMyWalletAddress } from 'account/myWalletAddress'
import { loadWallet } from 'account/utils/loadWallet'
import { generateKeysFromMnemonic } from 'key/genKeyFromMnemonic'
import { createSignature } from 'sign/createSign'
import { mineLog } from 'logging/mineLog'
import { logToConsole } from 'logging/logging'
import { loggingErr } from 'logging/errorLog'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { formatStr } from 'nexchain/lib/formatStr'
import { removeMemPool } from 'nexchain/storage/mempool/removeMempool'
import { isTxExecuted } from 'nexchain/transaction/isTxExecuted'

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
 *       kesegaran tip; bila lolos, finalisasi (nonce/hash/sign/size) dan
 *       commitBlock — hadiah terkredit lewat processTransact (coinbase).
 *
 * Node tidak pernah menghitung PoW sendiri; loop-nya ada di klien
 * (`client/miner/runMiner.ts`), sehingga LevelDB & event loop node bebas
 * dan RPC tetap melayani selama mining berlangsung.
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
		const genesis = await getBlockByHeight(0, 'json')
		if (!genesis) {
			return {
				status: false,
				error: 'Genesis block not found — buat genesis dulu (auto saat RPC boot)',
			}
		}

		// Alamat penerima hadiah: dari miner; bila tidak dikirim, pakai
		// wallet node (kegunaan lokal tanpa argumen).
		const provided = parseMinerAddress(rawParams)
		let minerAddress: string
		if (provided) {
			if (!isValidAddress(provided)) {
				return {
					status: false,
					error: `Invalid miner address: ${formatStr(provided)}`,
				}
			}
			minerAddress = provided
		} else {
			minerAddress = getMyWalletAddress()
			if (!minerAddress) {
				return {
					status: false,
					error:
						'minerAddress not provided and node wallet not found — kirim {minerAddress}',
				}
			}
		}

		// Jangan membangun di atas rantai yang rusak: integrity check kini
		// benar-benar memeriksa hasil (verifyStruct await, PoW, signature...)
		// — lihat verify/verifyIntegrity.
		if (!(await isChainsValid())) {
			return {
				status: false,
				error:
					'Chain integrity check failed — periksa log node sebelum melanjutkan mining',
			}
		}

		// Jalur expiry: buang job kadaluarsa LEBIH AWAL (membebaskan slot
		// MAX_JOBS sebelum job baru dibuat) dan ambil retarget dari difficulty
		// job expired terakhir. Basisnya kumulatif (job expired, bukan tip)
		// sehingga penurunan tidak mandek di `tip - 4` selama blok tak
		// ter-commit — lihat `cleanupExpiredJobs`.
		const expiryDifficulty = cleanupExpiredJobs(await getLastBlockTimestamp())

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

		// Terapkan retarget jalur expiry SEBELUM payload disusun, dan hanya
		// bila lebih rendah dari hasil retarget template — jalur expiry
		// dibolehkan hanya MENURUNKAN difficulty (tidak pernah menaikkan).
		if (
			expiryDifficulty !== undefined &&
			expiryDifficulty < template.block.header.difficulty
		) {
			template.block.header.difficulty = expiryDifficulty
		}
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

		// Finalisasi: isi field yang tidak ikut preimage PoW.
		const block = job.block
		block.block.header.nonce = nonce
		block.block.header.hash = hash

		const wallet = loadWallet()
		if (!wallet) {
			return {
				status: false,
				error: 'Node wallet not found — cannot sign block',
			}
		}
		const { privateKey } = generateKeysFromMnemonic(wallet.phrase)
		block.block.sign = createSignature(hash, privateKey)
		// size dihitung terakhir (mencakup sign) — size tidak ikut preimage.
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
