/**
 * Smoke test jalur mining untuk `miner-ui` — dijalankan terhadap node RPC
 * yang HIDUP. Meniru persis alur UI (`nex_getWork` → hash → `nex_submitWork`)
 * lalu memverifikasi hasilnya (tip bergerak, minerId cocok, hadiah terkredit).
 *
 * Ini BUKAN pengganti `check:*` offline — ia sengaja menyentuh node hidup
 * (membuat wallet, menambang satu blok, mengubah state rantai).
 *
 * Pakai:
 *   bun run rpc:start        # di terminal lain
 *   bun run miner:smoke
 */
import { hashWithNonce } from 'src/core/consensus/Pow'
import { meetsDifficulty } from 'src/core/consensus/difficulty'
import { hexToString } from 'src/core/encoding/hex/hexToString'
import type { HexString } from 'src/types/block'

const RPC_URL = process.env.NEX_RPC_URL ?? 'http://localhost:8000/rpc'
const HASH_CHUNK = 50_000
/** Batas waktu mencari nonce — jauh di bawah TTL job (5 menit) di node. */
const SOLVE_TIMEOUT_MS = 120_000

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

interface BlockSummary {
	height: number
	minerId: string
	hash: string
	difficulty: number
}

interface AccountSummary {
	balance: number
	address: string
}

interface ReadyJob {
	jobId: string
	payload: string
	difficulty: number
	height: number
	expiresAt: number
}

class SmokeFailure extends Error {}

const ok = (message: string): void => console.log(`\u2713 ${message}`)

let requestId = 0

const rpc = async <T>(method: string, params?: unknown): Promise<T> => {
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

/** Validasi respons getWork → job lengkap, atau `null`. */
const readJob = (work: WorkResponse): ReadyJob | null => {
	if (!work.status) return null
	const { jobId, payload, difficulty, height, expiresAt } = work
	if (
		typeof jobId !== 'string' ||
		typeof payload !== 'string' ||
		typeof difficulty !== 'number' ||
		typeof height !== 'number' ||
		typeof expiresAt !== 'number'
	) {
		return null
	}
	return { jobId, payload, difficulty, height, expiresAt }
}

const main = async (): Promise<void> => {
	console.log(`Smoke test miner-ui \u2192 ${RPC_URL}\n`)

	// 1. Probe koneksi.
	const chainId = await rpc<number | undefined>('nex_getChainId')
	if (typeof chainId !== 'number') {
		throw new SmokeFailure('nex_getChainId tidak mengembalikan angka')
	}
	ok(`nex_getChainId = ${chainId}`)

	// 2. Alamat penerima hadiah (node tidak punya wallet).
	const walletJson = await rpc<string>('nex_createWallet')
	const wallet = JSON.parse(walletJson) as { address?: string }
	const address = wallet.address
	if (typeof address !== 'string') {
		throw new SmokeFailure('nex_createWallet tidak mengembalikan address')
	}
	if (
		!(address.startsWith('NxC') || address.startsWith('NxS')) ||
		address.length !== 43
	) {
		throw new SmokeFailure(`alamat tidak sesuai aturan node: ${address}`)
	}
	ok(`alamat hadiah = ${address}`)

	// 3. Minta job.
	const job = readJob(
		await rpc<WorkResponse>('nex_getWork', { minerAddress: address }),
	)
	if (!job) {
		throw new SmokeFailure('nex_getWork ditolak atau respons tidak lengkap')
	}
	ok(
		`nex_getWork \u2192 job ${job.jobId}, height #${job.height}, ` +
			`difficulty ${job.difficulty} bits`,
	)

	// 4. Cari nonce — inti yang dijalankan Web Worker di UI.
	const startedAt = Date.now()
	const deadline = Math.min(job.expiresAt, startedAt + SOLVE_TIMEOUT_MS)
	let nonce = 0
	let hashes = 0
	let solutionNonce = -1
	let solutionHash = ''
	while (Date.now() < deadline && solutionNonce < 0) {
		const chunkEnd = nonce + HASH_CHUNK
		for (; nonce < chunkEnd; nonce++) {
			hashes++
			const candidate = hashWithNonce(job.payload, nonce)
			if (meetsDifficulty(candidate, job.difficulty)) {
				solutionNonce = nonce
				solutionHash = candidate
				break
			}
		}
	}
	if (solutionNonce < 0) {
		throw new SmokeFailure('tidak menemukan nonce sebelum tenggat')
	}
	const elapsedMs = Date.now() - startedAt
	ok(
		`solusi nonce ${solutionNonce} dalam ${(elapsedMs / 1000).toFixed(1)}s ` +
			`(${hashes.toLocaleString('en-US')} hash)`,
	)

	// 5. Submit — node memverifikasi ulang & commit.
	const submitted = await rpc<SubmitResponse>('nex_submitWork', {
		jobId: job.jobId,
		nonce: solutionNonce,
		hash: solutionHash,
	})
	if (!submitted.status) {
		throw new SmokeFailure(
			`nex_submitWork ditolak: ${submitted.error ?? 'unknown'}`,
		)
	}
	const minedHeight = submitted.height
	if (typeof minedHeight !== 'number') {
		throw new SmokeFailure('submit tidak mengembalikan height')
	}
	ok(`blok #${minedHeight} DITERIMA \u2014 ${submitted.hash ?? solutionHash}`)

	// 6. Tip harus bergerak & minerId harus alamat kita.
	const blocks = await rpc<BlockSummary[]>('nex_getRecentBlocks', { count: 3 })
	const tip = blocks[0]
	if (!tip) {
		throw new SmokeFailure('nex_getRecentBlocks tidak mengembalikan blok')
	}
	if (tip.height !== minedHeight) {
		throw new SmokeFailure(
			`tip #${tip.height} \u2260 blok yang ditambang #${minedHeight}`,
		)
	}
	if (tip.minerId !== address) {
		throw new SmokeFailure(
			`minerId tip (${tip.minerId}) bukan alamat miner (${address})`,
		)
	}
	ok(`nex_getRecentBlocks \u2192 tip #${tip.height}, minerId cocok`)

	// 7. Hadiah harus terkredit.
	// Respons `nex_getAccount` adalah `stringToHex(JSON.stringify(akun))` —
	// hex DENGAN prefix `0x`, jadi harus lewat `hexToString` (dekoder
	// kanonik yang juga dipakai UI lewat `decodeHexJson`).
	const rawAccount = await rpc<string>('nex_getAccount', address)
	const account = JSON.parse(
		hexToString(rawAccount as HexString),
	) as AccountSummary
	if (!(account.balance > 0)) {
		throw new SmokeFailure('saldo hadiah tidak bertambah setelah blok ter-commit')
	}
	ok(`saldo hadiah = ${account.balance} nexu`)

	console.log(
		'\nSMOKE OK \u2014 jalur getWork \u2192 hash \u2192 submitWork \u2192 hadiah terverifikasi.',
	)
}

main().catch((error: unknown) => {
	console.error(
		`\n\u2717 ${error instanceof Error ? error.message : String(error)}`,
	)
	process.exit(1)
})
