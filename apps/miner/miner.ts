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
 *
 * File ini SENGAJA tetap mandiri (nol dependensi) untuk kemudahan distribusi.
 * Karena itu loop PoW di sini memakai versi buffer-tetap yang di-inline —
 * semantiknya identik dengan `PowHasher` di `src/core/encoding/sha256.ts`
 * (dibuktikan gate `check:pow`), hanya saja tidak bisa diimpor tanpa
 * mengorbankan sifat satu-file.
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

/** PoW hash = SHA-256(`${payload}${nonce}`) hex — rujukan lambat (satu hash). */
const hashWithNonce = (payload: string, nonce: number): string =>
	createHash('sha256').update(`${payload}${nonce}`).digest('hex')

/**
 * Hasher ber-buffer-tetap untuk loop panas.
 *
 * Payload di-encode SEKALI; tiap hash hanya menulis digit nonce ke buffer tetap
 * (tanpa concat string, tanpa alokasi per iterasi). Hasilnya byte-per-byte
 * identik dengan `hashWithNonce` — lihat komentar header.
 *
 * `Math.floor(n / 10)` dipakai, BUKAN `(n / 10) | 0`: operator `| 0` memaksa
 * int32 dan menghasilkan digit salah untuk nonce >= 2^31.
 */
class PowHasher {
	private readonly combined: Buffer
	private readonly base: number

	constructor(payload: string) {
		const payloadBytes = Buffer.from(payload, 'utf8')
		this.base = payloadBytes.length
		this.combined = Buffer.allocUnsafe(this.base + 24)
		payloadBytes.copy(this.combined, 0)
	}

	hash(nonce: number): string {
		let len = 0
		let n = nonce
		if (n === 0) {
			this.combined[this.base] = 48
			len = 1
		} else {
			while (n > 0) {
				this.combined[this.base + len++] = 48 + (n % 10)
				n = Math.floor(n / 10)
			}
			const start = this.base
			const end = this.base + len - 1
			for (let i = start, j = end; i < j; i++, j--) {
				const t = this.combined[i]
				this.combined[i] = this.combined[j]
				this.combined[j] = t
			}
		}
		return createHash('sha256')
			.update(this.combined.subarray(0, this.base + len))
			.digest('hex')
	}
}

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

/**
 * Header Basic Auth OPSIONAL untuk node dengan `RPC_USER`/`RPC_PASSWORD`.
 *
 * Kedua env harus terisi bersamaan; kalau tidak, `undefined` (node lokal
 * tanpa kredensial tetap jalan tanpa header). Header ini dibawa SEMUA
 * panggilan (baca maupun tulis) — node hanya menuntutnya untuk method tulis
 * (`nex_getWork` / `nex_submitWork`) dan mengabaikannya di method baca.
 */
const AUTH_HEADER: string | undefined = (() => {
	const user = process.env.NEX_RPC_USER
	const password = process.env.NEX_RPC_PASS
	if (!user || !password) return undefined
	return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`
})()

let requestId = 0

const rpcCall = async <T>(
	rpcUrl: string,
	method: string,
	params?: unknown,
): Promise<T> => {
	const response = await fetch(rpcUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(AUTH_HEADER ? { authorization: AUTH_HEADER } : {}),
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++requestId,
			method,
			...(params === undefined ? {} : { params }),
		}),
	})
	if (!response.ok) {
		// 401/403 dari node berarti autentikasi method tulis menolak —
		// beri petunjuk env yang benar supaya operator tidak menebak-nebak.
		const hint =
			response.status === 401 || response.status === 403
				? ' — method ini butuh Basic Auth: set NEX_RPC_USER dan NEX_RPC_PASS'
				: ''
		throw new Error(`HTTP ${response.status} ${response.statusText}${hint}`)
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
	// Encode payload sekali untuk seluruh job (jalur panas).
	const hasher = new PowHasher(work.payload)
	let nonce = 0
	while (isRunning()) {
		if (Date.now() >= work.expiresAt) return null
		const chunkEnd = nonce + HASH_CHUNK
		for (; nonce < chunkEnd; nonce++) {
			const hash = hasher.hash(nonce)
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
	console.log(
		`  auth    : ${AUTH_HEADER ? 'Basic (NEX_RPC_USER/NEX_RPC_PASS)' : 'tanpa kredensial'}`,
	)

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

/**
 * Verifikasi-diri: hasher cepat (PowHasher) harus byte-per-byte sama dengan
 * `hashWithNonce`. Dijalankan sebelum mining supaya kesalahan encoding
 * ketahuan di sini, bukan setelah nonce ditemukan dan ditolak node.
 */
const selfCheckHasher = (): boolean => {
	const samples: Array<[string, number]> = [
		['', 0],
		['abc', 1],
		['{"height":1,"tx":[]}', 999999],
		['caf\u00e9-\u4e2d\u6587', Number.MAX_SAFE_INTEGER],
	]
	for (const [payload, nonce] of samples) {
		const fast = new PowHasher(payload).hash(nonce)
		const slow = hashWithNonce(payload, nonce)
		if (fast !== slow) return false
	}
	return true
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

	if (!selfCheckHasher()) {
		console.error(
			'FATAL: hasher cepat tidak identik dengan sha256 rujukan — miner dihentikan.',
		)
		process.exit(1)
	}

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
