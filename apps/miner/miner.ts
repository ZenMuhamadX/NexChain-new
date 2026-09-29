/**
 * NexChain Miner CLI — SATU file mandiri, nol dependensi, tanpa clone repo.
 *
 * Pakai di PC mana pun:
 *   1. copy file ini saja;
 *   2. pasang runtime Bun (https://bun.sh) — tidak perlu `bun install`;
 *   3. `bun run mineCLI.ts` → jawab pertanyaan → mining dimulai.
 *
 * Kebutuhan miner HANYA: URL node + alamat wallet penerima hadiah.
 * TIDAK perlu seed/private key (blok ditandatangani NODE saat submit lolos),
 * tidak perlu database, tidak perlu source code blockchain.
 *
 * Definisi konsensus disalin identik dari sumber kebenaran node:
 *   - `meetsDifficulty`  — salinan verbatim dari nexchain/miner/difficulty.ts;
 *   - `sha256(payload‖nonce)` — node:crypto, dijamin identik dengan js-sha256
 *     yang dipakai node (lihat catatan di nexchain/block/sha256.ts).
 * Node tetap memverifikasi ulang setiap submit (nex_submitWork) — miner ini
 * hanya membantu mencari nonce, tidak bisa memanipulasi rantai.
 */
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Konsensus — WAJIB identik dengan node
// ---------------------------------------------------------------------------

/** Salinan verbatim nexchain/miner/difficulty.ts → meetsDifficulty. */
const meetsDifficulty = (hash: string, bits: number): boolean => {
	if (typeof hash !== 'string' || hash.length !== 64) return false
	if (!Number.isFinite(bits)) return false
	if (bits <= 0) return true // difficulty 0 = tanpa syarat

	const zeroDigits = Math.floor(bits / 4)
	const remainder = bits - zeroDigits * 4 // di [0, 4)

	for (let i = 0; i < zeroDigits; i++) {
		if (hash[i] !== '0') return false
	}
	if (remainder > 0) {
		const nibble = Number.parseInt(hash[zeroDigits], 16)
		if (!Number.isFinite(nibble)) return false
		if (nibble >= 2 ** (4 - remainder)) return false
	}
	return true
}

/** PoW hash = SHA-256(`${payload}${nonce}`) hex — identik dgn hashWithNonce node. */
const hashWithNonce = (payload: string, nonce: number): string =>
	createHash('sha256').update(`${payload}${nonce}`).digest('hex')

/** Salinan nexchain/transaction/utils/isValidAddress.ts — kriteria node. */
const isValidAddress = (address: string): boolean => {
	if (address.startsWith('NxS') && address.length === 43) return true
	if (address.startsWith('NxC') && address.length === 43) return true
	return false
}

// ---------------------------------------------------------------------------
// Konstanta miner
// ---------------------------------------------------------------------------

const DEFAULT_RPC_URL = 'http://localhost:8000/rpc'
const HASH_CHUNK = 50_000
const HASHRATE_LOG_MS = 5_000
const RETRY_DELAY_MS = 3_000

// ---------------------------------------------------------------------------
// Transport JSON-RPC (HTTP POST, tanpa dependensi)
// ---------------------------------------------------------------------------

let requestId = 0

const rpcCall = async <T>(
	rpcUrl: string,
	method: string,
	params?: unknown,
): Promise<T> => {
	const response = await fetch(rpcUrl, {
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
// Tanya-jawab CLI (reader stdin sederhana — buffer antrian baris, jadi aman
// baik saat TTY interaktif maupun saat input di-pipe dari shell)
// ---------------------------------------------------------------------------

const lineQueue: string[] = []
let linePending = ''
let wakeWaiter: (() => void) | null = null

const pushLine = (line: string): void => {
	lineQueue.push(line)
	wakeWaiter?.()
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
	linePending += chunk
	const parts = linePending.split(/\r?\n/)
	linePending = parts.pop() ?? ''
	for (const part of parts) pushLine(part)
})
process.stdin.on('end', () => {
	if (linePending.length > 0) pushLine(linePending)
	linePending = ''
})

/** Tampilkan label lalu tunggu satu baris jawaban ("" = pakai default). */
const ask = async (label: string, def?: string): Promise<string> => {
	const suffix = def !== undefined ? ` [${def}]` : ''
	process.stdout.write(`${label}${suffix} : `)
	while (lineQueue.length === 0) {
		await new Promise<void>((resolve) => {
			wakeWaiter = () => {
				wakeWaiter = null
				resolve()
			}
		})
	}
	const raw = (lineQueue.shift() ?? '').trim()
	return raw === '' && def !== undefined ? def : raw
}

// ---------------------------------------------------------------------------
// Loop PoW — identik dengan client/miner/runMiner.ts (sudah teruji E2E)
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

/** Cari nonce per-potong; ctrl+C & expiry job dicek di antara potongan. */
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

const runMiner = async (
	rpcUrl: string,
	minerAddress: string,
): Promise<void> => {
	let running = true
	process.once('SIGINT', () => {
		running = false
		console.log('\nStopping miner — menyelesaikan potongan hash berjalan...')
	})

	console.log('NexChain external miner')
	console.log(`  address : ${minerAddress}`)
	console.log(`  rpc     : ${rpcUrl}`)

	let totalHashes = 0

	while (running) {
		// ---- 1. minta job ------------------------------------------------
		let work: Work
		try {
			const result = await rpcCall<WorkResponse>(rpcUrl, 'nex_getWork', {
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
			const submitted = await rpcCall<SubmitResponse>(
				rpcUrl,
				'nex_submitWork',
				{
					jobId: work.jobId,
					nonce: solution.nonce,
					hash: solution.hash,
				},
			)
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

// ---------------------------------------------------------------------------
// Entry: tanya-jawab dulu, lalu mining
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
	console.log('NexChain Miner CLI — mandiri (satu file, nol dependensi)')
	console.log(
		'Kebutuhan hanya URL node + alamat wallet.',
		'Tidak perlu seed/private key.\n',
	)

	// ---- 1. URL RPC node -------------------------------------------------
	let rpcUrl = ''
	while (!rpcUrl) {
		const input = await ask('Alamat RPC node', DEFAULT_RPC_URL)
		try {
			const parsed = new URL(input)
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
				rpcUrl = input
			} else {
				console.log('  -> protocol harus http:// atau https://, ulangi.')
			}
		} catch {
			console.log('  -> URL tidak valid, ulangi.')
		}
	}

	// ---- 2. alamat wallet (penerima hadiah) ------------------------------
	let minerAddress = ''
	while (!minerAddress) {
		const input = await ask('Alamat wallet (penerima hadiah)')
		if (isValidAddress(input)) {
			minerAddress = input
		} else {
			console.log(
				'  -> format salah: harus diawali NxC/NxS dan 43 karakter, ulangi.',
			)
		}
	}

	// ---- 3. tes koneksi sekali supaya URL salah gagal cepat & jelas ------
	try {
		const tip = await rpcCall<unknown>(rpcUrl, 'nex_getRecentBlocks', {
			count: 1,
		})
		const height =
			Array.isArray(tip) && tip[0] && typeof tip[0] === 'object'
				? (tip[0] as { height?: number }).height
				: undefined
		console.log(
			`\nOK node terhubung${height !== undefined ? ` — tip height #${height}` : ''}`,
		)
	} catch (error) {
		console.error(`\nNode tidak terjangkau: ${errorMessage(error)}`)
		console.error('  Periksa URL RPC / pastikan node berjalan lalu ulangi.')
		process.exit(1)
	}

	// ---- 4. konfirmasi ----------------------------------------------------
	const answer = (await ask('Mulai mining?', 'y')).toLowerCase()
	if (answer === 'n' || answer === 'no') {
		console.log('Dibatalkan.')
		process.exit(0)
	}
	console.log('')

	await runMiner(rpcUrl, minerAddress)
	process.exit(0)
}

void main()
