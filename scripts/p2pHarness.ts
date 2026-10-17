/**
 * Helper bersama untuk smoke P2P yang MENYALAKAN NODE SUNGGUHAN.
 *
 * Dipakai dua gate:
 *
 *   - `p2p:smoke` (`p2pSmoke.ts`) — tiga node, alur normal: handshake, sync
 *     blok, relay tx, gerbang IBD, reconnect.
 *   - `p2p:fork` (`p2pForkSmoke.ts`) — dua node yang sengaja DIPISAH, masing-
 *     masing menambang, lalu dipertemukan supaya cabang lebih berat menang.
 *
 * Semua helper di sini menyentuh proses anak, port, dan LevelDB — bukan
 * helper offline. `check:p2p` (yang murni) tidak mengimpor berkas ini.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createPowHasher } from 'src/core/consensus/Pow'
import { meetsDifficulty } from 'src/core/consensus/difficulty'

/** Batas waktu boot node: RPC menjawab DAN genesis sudah tertulis. */
export const BOOT_TIMEOUT_MS = 30_000
/** Batas waktu pencarian nonce untuk satu blok. */
export const MINE_TIMEOUT_MS = 120_000
/** Jeda antar-poll status sinkronisasi. */
export const SYNC_POLL_MS = 500

// ---------------------------------------------------------------------------
// Helper gate
// ---------------------------------------------------------------------------

let pass = 0
let fail = 0

/** Catat satu asersi; `extra` dicetak dalam tanda kurung siku. */
export const check = (name: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}${extra ? `  [${extra}]` : ''}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? `  [${extra}]` : ''}`)
	}
}

/** Apakah sudah ada asersi yang gagal (dipakai untuk lampiran diagnosis). */
export const failed = (): boolean => fail > 0

/** Cetak rekap dan set kode keluar proses. */
export const report = (): void => {
	console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
	process.exitCode = fail > 0 ? 1 : 0
}

export const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Klien JSON-RPC ke node hidup
// ---------------------------------------------------------------------------

let requestId = 0

export const rpc = async <T>(
	url: string,
	method: string,
	params?: unknown,
): Promise<T> => {
	const response = await fetch(url, {
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

/** Subset field state rantai yang dibaca smoke ini. */
export interface ChainState {
	currentBlockHeight?: number
	currentBlockHash?: string
}

/**
 * Baca state rantai lewat `nex_getBlockState`.
 *
 * Responsnya objek JSON polos (lihat `src/rpc/method.ts`). Guard KETAT: selain
 * objek (mis. string ber-envelope hex lama) dianggap tak terbaca, sehingga
 * smoke gagal TERLIHAT, bukan diam-diam diamati `height=undefined`.
 */
export const readState = async (
	url: string,
): Promise<ChainState | undefined> => {
	const raw = await rpc<unknown>(url, 'nex_getBlockState')
	if (raw === null || typeof raw !== 'object') return undefined
	return raw as ChainState
}

/** Subset field entri mempool yang dibaca smoke ini. */
export interface MempoolEntry {
	txHash?: string
}

/** Baca isi mempool (`nex_getMempool` — JSON polos, bukan hex). */
export const readMempool = async (url: string): Promise<MempoolEntry[]> => {
	const raw = await rpc<unknown>(url, 'nex_getMempool')
	return Array.isArray(raw) ? (raw as MempoolEntry[]) : []
}

/**
 * Nonce berikutnya untuk sebuah alamat (`nex_getNextNonce`).
 *
 * Responsnya angka JSON polos — guard ketat: selain `number` dianggap 0.
 */
export const readNextNonce = async (
	url: string,
	address: string,
): Promise<number> => {
	const raw = await rpc<unknown>(url, 'nex_getNextNonce', address)
	return typeof raw === 'number' ? raw : 0
}

/** Subset status sinkronisasi yang dibaca smoke ini (`nex_getSyncStatus`). */
export interface SyncStatusView {
	phase?: string
	syncing?: boolean
	localHeight?: number
	targetHeight?: number
	updatedAt?: number
}

/** Baca status sinkronisasi (`nex_getSyncStatus` — JSON polos, bukan hex). */
export const readSyncStatus = async (url: string): Promise<SyncStatusView> => {
	const raw = await rpc<unknown>(url, 'nex_getSyncStatus')
	if (raw === null || typeof raw !== 'object') return {}
	return raw as SyncStatusView
}

/** Subset snapshot peer yang dibaca smoke ini (`nex_getPeerInfo`). */
export interface PeerInfoView {
	count?: number
	peers?: Array<{ handshaked?: boolean; status?: { bestHeight?: number } }>
	maxPeers?: number
}

/** Baca snapshot peer (`nex_getPeerInfo` — JSON polos, bukan hex). */
export const readPeerInfo = async (url: string): Promise<PeerInfoView> => {
	const raw = await rpc<unknown>(url, 'nex_getPeerInfo')
	if (raw === null || typeof raw !== 'object') return {}
	return raw as PeerInfoView
}

// ---------------------------------------------------------------------------
// Proses node
// ---------------------------------------------------------------------------

export interface NodeProcess {
	readonly label: string
	readonly child: ChildProcess
	readonly url: string
	output(): string
}

/**
 * Jalankan satu node dengan konfigurasi terisolasi.
 *
 * Kredensial method tulis dikosongkan supaya `nex_getWork`/`nex_submitWork`
 * deterministik: loopback tanpa Basic Auth. Nilai kosong di env anak MENANG
 * atas isi `.env` root (dotenv maupun loader native Bun tidak menimpa variabel
 * yang sudah ada), jadi hasilnya sama di mesin mana pun.
 */
export const spawnNode = (
	label: string,
	dataDir: string,
	rpcPort: number,
	p2pPort: number,
	peers: string,
	extraEnv: Record<string, string> = {},
): NodeProcess => {
	const child = spawn('bun', ['apps/node/server.ts'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			NEX_DATA_DIR: dataDir,
			NEX_RPC_PORT: String(rpcPort),
			RPC_BIND_HOST: '127.0.0.1',
			RPC_USER: '',
			RPC_PASSWORD: '',
			NEX_P2P_ENABLED: '1',
			NEX_P2P_PORT: String(p2pPort),
			NEX_P2P_BIND_HOST: '127.0.0.1',
			NEX_P2P_PEERS: peers,
			// Sync berkala & reconnect dipendekkan supaya smoke cepat; produksi
			// memakai default 10 dtk / 15 dtk (`src/p2p/config.ts`).
			NEX_P2P_SYNC_INTERVAL_MS: '2000',
			NEX_P2P_RECONNECT_INTERVAL_MS: '3000',
			...extraEnv,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let log = ''
	const capture = (chunk: unknown): void => {
		// Batasi memori: cukup simpan EKOR log untuk diagnosis kegagalan.
		log = (log + String(chunk)).slice(-262_144)
	}
	child.stdout?.on('data', capture)
	child.stderr?.on('data', capture)
	return {
		label,
		child,
		url: `http://127.0.0.1:${rpcPort}/rpc`,
		output: () => log,
	}
}

/**
 * Tunggu RPC menjawab DAN genesis sudah tertulis (blok height 0 ada di
 * `nex_getRecentBlocks`). RPC bisa menjawab sebelum callback listen selesai
 * membuat genesis — menunggu blok 0 membuat "siap" benar-benar siap.
 */
export const waitReady = async (node: NodeProcess): Promise<void> => {
	const deadline = Date.now() + BOOT_TIMEOUT_MS
	while (Date.now() < deadline) {
		if (node.child.exitCode !== null) {
			throw new Error(
				`${node.label} keluar lebih dulu (exit ${node.child.exitCode})`,
			)
		}
		try {
			const blocks = await rpc<unknown[]>(node.url, 'nex_getRecentBlocks', {
				count: 1,
			})
			if (Array.isArray(blocks) && blocks.length > 0) return
		} catch {
			// RPC belum siap menerima koneksi — coba lagi.
		}
		await delay(250)
	}
	throw new Error(`${node.label} tidak siap dalam ${BOOT_TIMEOUT_MS / 1000}s`)
}

/**
 * Hentikan proses anak dan tunggu benar-benar keluar sebelum direktori
 * datanya dihapus — LevelDB masih memegang kunci file sampai proses keluar,
 * dan di Windows itu membuat `rm` gagal dengan EBUSY.
 */
export const stopNode = async (child: ChildProcess): Promise<void> => {
	if (child.exitCode !== null) return
	await new Promise<void>((done) => {
		const timer = setTimeout(done, 5000)
		child.once('exit', () => {
			clearTimeout(timer)
			done()
		})
		child.kill()
	})
}

/** Hapus direktori sementara, dengan percobaan ulang untuk lock OS lambat. */
export const rmWithRetry = async (dir: string): Promise<void> => {
	for (let attempt = 0; attempt < 12; attempt++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true })
			return
		} catch {
			await delay(250)
		}
	}
	// Sisa file sementara bukan kegagalan produk — jangan menambah noise.
	console.log(`  (catatan) tidak bisa menghapus ${dir} — dilewati`)
}

// ---------------------------------------------------------------------------
// Mining satu blok lewat jalur RPC (identik dengan miner eksternal)
// ---------------------------------------------------------------------------

export interface WorkJob {
	status?: boolean
	error?: string
	jobId?: string
	payload?: string
	difficulty?: number
	height?: number
	expiresAt?: number
}

export interface SubmitResult {
	status?: boolean
	error?: string
}

export interface MinedBlock {
	height: number
	hash: string
}

export const mineOneBlock = async (
	url: string,
	minerAddress: string,
	timeoutMs = MINE_TIMEOUT_MS,
): Promise<MinedBlock> => {
	const work = await rpc<WorkJob>(url, 'nex_getWork', { minerAddress })
	if (
		!work.status ||
		typeof work.jobId !== 'string' ||
		typeof work.payload !== 'string' ||
		typeof work.difficulty !== 'number' ||
		typeof work.height !== 'number' ||
		typeof work.expiresAt !== 'number'
	) {
		throw new Error(
			`nex_getWork gagal: ${work.error ?? 'respons tidak lengkap'}`,
		)
	}

	const startedAt = Date.now()
	// Loop PoW memakai hasher ber-payload-tetap (satu encoding, banyak nonce).
	const deadline = Math.min(work.expiresAt, startedAt + timeoutMs)
	const hasher = createPowHasher(work.payload)
	let nonce = 0
	let hash = ''
	let found = false
	while (Date.now() < deadline) {
		hash = hasher.hash(nonce)
		if (meetsDifficulty(hash, work.difficulty)) {
			found = true
			break
		}
		nonce++
	}
	if (!found) {
		throw new Error(
			`nonce tidak ditemukan untuk difficulty ${work.difficulty} bits`,
		)
	}
	const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
	console.log(
		`  ....  nonce ${nonce} ditemukan dalam ${elapsed}s ` +
			`(difficulty ${work.difficulty} bits)`,
	)

	const submit = await rpc<SubmitResult>(url, 'nex_submitWork', {
		jobId: work.jobId,
		nonce,
		hash,
	})
	if (!submit.status) {
		throw new Error(`nex_submitWork ditolak: ${submit.error ?? 'unknown'}`)
	}
	return { height: work.height, hash }
}
