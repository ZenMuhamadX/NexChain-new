import { rpcRequest } from 'src/client/rpc-client/lib/rpcRequest'
import { getRpcUrl, getRpcCredentials } from './rpcUrl'
import type { structBalance } from 'src/types/balance'

/**
 * Pembungkus RPC khusus miner.
 *
 * Hanya tiga metode yang dipakai:
 *   - `nex_getWork`          → job (payload + difficulty + expiry)
 *   - `nex_submitWork`       → kirim solusi, node verifikasi ulang & commit
 *   - `nex_getRecentBlocks`  → tip height / status koneksi
 * ditambah `nex_getChainId` (probe) dan `nex_getAccount` (saldo hadiah).
 *
 * Semua hasil RPC kini JSON polos.
 *
 * Dua dari metode di atas (`nex_getWork` / `nex_submitWork`) adalah method
 * TULIS — bila node menyetel `RPC_USER`/`RPC_PASSWORD` ia menuntut HTTP Basic,
 * jadi keduanya dikirim lewat `writeRequest` lokal yang menyelipkan header
 * `Authorization` dari kredensial Settings (lihat `lib/rpcUrl.ts`).
 * Metode baca tetap lewat `rpcRequest` biasa tanpa autentikasi.
 */

/** Respons mentah `nex_getWork` — longgar, divalidasi di pemanggil. */
export interface WorkResponse {
	status: boolean
	jobId?: string
	payload?: string
	difficulty?: number
	height?: number
	previousBlockHash?: string
	minerAddress?: string
	expiresAt?: number
	targetBlockTimeMs?: number
	error?: string
}

/** Job yang sudah tervalidasi lengkap — siap di-hash worker. */
export interface MiningJob {
	jobId: string
	payload: string
	difficulty: number
	height: number
	previousBlockHash: string
	expiresAt: number
}

export interface SubmitResponse {
	status: boolean
	height?: number
	hash?: string
	difficulty?: number
	minerAddress?: string
	error?: string
}

/** Ringkasan blok dari `nex_getRecentBlocks` (JSON polos). */
export interface BlockSummary {
	height: number
	hash: string
	previousBlockHash: string
	timestamp: number
	minerId: string
	txCount: number
	size: number
	status: string
	difficulty: number
	blockReward: number
	totalReward: number
}

/**
 * Header `Authorization: Basic …` dari kredensial Settings — `undefined`
 * bila belum lengkap, sehingga node TANPA auth tetap menerima request
 * tanpa header (perilaku lama tidak berubah).
 *
 * `btoa` hanya menerima Latin-1, jadi string-nya dulu di-encode UTF-8.
 */
const basicAuthHeader = (): string | undefined => {
	const { user, password } = getRpcCredentials()
	if (!user || !password) return undefined
	const bytes = new TextEncoder().encode(`${user}:${password}`)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return `Basic ${btoa(binary)}`
}

/** Batas tunggu — sama dengan `src/client/rpc-client/lib/rpcClient.ts`. */
const RPC_TIMEOUT_MS = 10_000

const timeoutSignal = (): AbortSignal | null =>
	typeof AbortSignal !== 'undefined' &&
	typeof (AbortSignal as { timeout?: unknown }).timeout === 'function'
		? AbortSignal.timeout(RPC_TIMEOUT_MS)
		: null

let writeRequestId = 0

/**
 * Request JSON-RPC untuk METHOD TULIS (`nex_getWork` / `nex_submitWork`),
 * lengkap dengan header Basic Auth bila kredensial tersimpan.
 *
 * Client bersama (`src/client/rpc-client/lib/rpcClient.ts`) tidak punya
 * titik sisipan header, dan hanya method tulis yang menuntut autentikasi —
 * jadi jalur fetch-nya ditulis sendiri dengan perilaku yang sama (URL aktif,
 * timeout, error non-200 / `error` JSON-RPC → throw; pemanggil di
 * `hooks/useMiner.ts` sudah menangkapnya dan mengulang dengan jeda).
 */
const writeRequest = async <T>(method: string, params: unknown): Promise<T> => {
	const headers: Record<string, string> = { 'content-type': 'application/json' }
	const authorization = basicAuthHeader()
	if (authorization) headers.authorization = authorization

	const response = await fetch(getRpcUrl(), {
		method: 'POST',
		headers,
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++writeRequestId,
			method,
			params,
		}),
		signal: timeoutSignal(),
	})
	if (!response.ok) {
		throw new Error(
			response.status === 401 || response.status === 403
				? `Node menolak method tulis (HTTP ${response.status}) — periksa RPC Username/Password di Settings.`
				: `HTTP ${response.status} ${response.statusText}`,
		)
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

export const getWork = (minerAddress: string): Promise<WorkResponse> =>
	writeRequest('nex_getWork', { minerAddress })

export const submitWork = (
	jobId: string,
	nonce: number,
	hash: string,
): Promise<SubmitResponse> =>
	writeRequest('nex_submitWork', { jobId, nonce, hash })

export const getRecentBlocks = async (count = 1): Promise<BlockSummary[]> => {
	const raw = await rpcRequest('nex_getRecentBlocks', { count })
	return Array.isArray(raw) ? (raw as BlockSummary[]) : []
}

export const getChainId = async (): Promise<number | undefined> =>
	(await rpcRequest('nex_getChainId', '')) as number | undefined

export const getAccount = async (
	address: string,
): Promise<structBalance | undefined> =>
	((await rpcRequest('nex_getAccount', address)) as
		structBalance | null | undefined) ?? undefined

/**
 * Validasi alamat penerima hadiah memakai aturan KANONIK node
 * (`NxC`/`NxS` + 43 karakter) — bukan salinan, supaya UI dan node tidak
 * pernah berbeda pendapat soal alamat yang sah.
 */
export { isValidAddress as isValidMinerAddress } from 'src/core/transaction/utils/isValidAddress'
