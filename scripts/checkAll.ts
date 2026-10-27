/**
 * Gerbang "semua test" — dijalankan otomatis sebelum push oleh `.husky/pre-push`.
 *
 * Tujuan: satu perintah (`bun run check:all`) yang menjalankan SELURUH gate repo
 * secara berurutan dan berhenti pada kegagalan pertama (fail-fast), supaya
 * commit yang rusak tidak sempat sampai ke GitHub.
 *
 * Fase (bisa dipilih lewat `NEX_CHECK_PHASES`, lihat bawah):
 *
 *   1. offline  — gate murni / LevelDB temp: `check` (tsc), `check:browser`, dan
 *      seluruh `check:*` + `genesis:check`. Tidak butuh node.
 *   2. local    — `wallet:smoke` (murni + `fake-indexeddb`, tanpa node).
 *   3. p2p      — `p2p:smoke` (menyalakan TIGA node sendiri) dan `p2p:fork`
 *      (dua node terisolasi yang lalu dipertemukan untuk membuktikan reorg
 *      cabang-terberat di jaringan hidup).
 *   4. live     — `miner:rs`. Butuh node HIDUP, jadi skrip ini menyalakan
 *      SATU node sementara untuknya: data dir di folder temp OS + port RPC
 *      bebas (tidak bentrok dengan node dev yang mungkin sedang jalan),
 *      kredensial tulis dikosongkan (-> loopback tanpa Basic Auth; nilai kosong
 *      di env anak MENANG atas isi `.env` root), P2P dimatikan. Node dimatikan
 *      kembali lewat try/finally (LevelDB menahan kunci file sampai proses
 *      benar-benar keluar — di Windows itu bikin `rm` EBUSY).
 *      Mining satu blok di node sementara ini murah: tinggi 1 punya induk
 *      genesis (parentHeight 0) sehingga difficulty TETAP 20 bit (~1M hash).
 *   5. explorer — smoke explorer. Ia BUTUH node dengan >= 5 blok
 *      (`nex_getRecentBlocks(5)`). Menyiapkannya sendiri mahal: rantai baru
 *      mulai 20 bit dan retarget menaikkan +2 bit/blok saat blok ditambang
 *      cepat, jadi 5 blok berturut-turut ~356M hash (~20 menit di mesin
 *      ~266 kH/s). Karena itu fase ini memakai NODE YANG SUDAH ADA:
 *        - URL dari `NEX_EXPLORER_RPC_URL`, kalau tidak ada dari
 *          `explorer/.env` (VITE_RPC_URL);
 *        - bila node tak terjangkau ATAU bloknya < 5, fase ini DILEWATI dengan
 *          peringatan (bukan gagal) — jalankan manual setelah node menyusul.
 *
 * Kesimpulan: TIDAK perlu menyalakan node manual; `miner:rs` memakai node
 * sementara, dan `explorer smoke` memakai node milikmu bila ada.
 *
 * Pakai:
 *   bun run check:all                        # semua fase (dipakai hook)
 *   NEX_CHECK_FAST=1 bun run check:all       # hanya fase offline (push cepat)
 *   NEX_CHECK_PHASES=live bun run check:all  # hanya fase tertentu (debug)
 *   NEX_EXPLORER_RPC_URL=http://... bun run check:all
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Akar repo, diturunkan dari lokasi berkas ini (bukan cwd) agar tahan diubah. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Batas menunggu node sementara siap menerima RPC + genesis tertulis. */
const BOOT_TIMEOUT_MS = 30_000
/** Explorer memanggil `nex_getRecentBlocks(5)`; node-nya harus punya >= 5 blok. */
const EXPLORER_MIN_BLOCKS = 5

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Pemilihan fase
// ---------------------------------------------------------------------------

type Phase = 'offline' | 'local' | 'p2p' | 'live' | 'explorer'
const ALL_PHASES: readonly Phase[] = [
	'offline',
	'local',
	'p2p',
	'live',
	'explorer',
]

/** `NEX_CHECK_FAST=1` -> hanya gate offline (tanpa smoke). */
const FAST = process.env.NEX_CHECK_FAST === '1'

const parsePhases = (raw: string | undefined): Phase[] => {
	if (!raw) return [...ALL_PHASES]
	const wanted = raw
		.split(',')
		.map((part) => part.trim())
		.filter((part): part is Phase =>
			(ALL_PHASES as readonly string[]).includes(part),
		)
	return wanted.length > 0 ? wanted : [...ALL_PHASES]
}

const phases: Phase[] = FAST
	? ['offline']
	: parsePhases(process.env.NEX_CHECK_PHASES)
const wants = (phase: Phase): boolean => phases.includes(phase)

// ---------------------------------------------------------------------------
// Pemanggilan gate (tiap gate = satu `bun run <script>`)
// ---------------------------------------------------------------------------

/**
 * Env anak untuk gate offline: `NEX_RPC_URL` dibuang dulu karena `check:tx`
 * mengandaikan default `localhost:8000/rpc` (lihat AGENTS.md). Nilai tambahan
 * (`extra`) dipasang SESUDAH penghapusan, jadi fase `live`/`explorer` tetap
 * bisa mengarahkan smoke ke node yang dituju.
 */
const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
	const env: NodeJS.ProcessEnv = { ...process.env }
	delete env.NEX_RPC_URL
	return { ...env, ...extra }
}

interface GateOptions {
	cwd?: string
	env?: NodeJS.ProcessEnv
}

const runScript = (script: string, options: GateOptions): Promise<number> =>
	new Promise((resolve) => {
		const child = spawn('bun', ['run', script], {
			cwd: options.cwd ?? ROOT,
			env: options.env ?? childEnv(),
			stdio: 'inherit',
		})
		child.once('error', () => resolve(1))
		child.once('exit', (code) => resolve(code ?? 1))
	})

class GateFailure extends Error {
	readonly label: string
	readonly script: string
	constructor(label: string, script: string) {
		super(`gate "${label}" gagal (bun run ${script})`)
		this.label = label
		this.script = script
	}
}

let gateIndex = 0

const runGate = async (
	label: string,
	script: string,
	options: GateOptions = {},
): Promise<void> => {
	gateIndex++
	console.log(`\n──────── [${gateIndex}] ${label} ────────`)
	const startedAt = Date.now()
	const code = await runScript(script, options)
	const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
	if (code !== 0) {
		console.error(`\n✗ GAGAL — ${label} (exit ${code}, ${secs}s)`)
		throw new GateFailure(label, script)
	}
	console.log(`✓ ${label} (${secs}s)`)
}

// ---------------------------------------------------------------------------
// Fase 1 — gate offline
// ---------------------------------------------------------------------------

const OFFLINE_GATES: ReadonlyArray<{ label: string; script: string }> = [
	{ label: 'typecheck (tsc)', script: 'check' },
	{ label: 'bundling browser', script: 'check:browser' },
	{ label: 'jalur tx', script: 'check:tx' },
	{ label: 'jumlah (amount)', script: 'check:amount' },
	{ label: 'wallet vault', script: 'check:wallet' },
	{ label: 'supply cap', script: 'check:cap' },
	{ label: 'difficulty retarget', script: 'check:difficulty' },
	{ label: 'aturan konsensus', script: 'check:consensus' },
	{ label: 'keamanan RPC', script: 'check:rpc' },
	{ label: 'P2P (framing/protokol)', script: 'check:p2p' },
	{ label: 'kebijakan tx', script: 'check:txpolicy' },
	{ label: 'storage', script: 'check:storage' },
	{ label: 'journal', script: 'check:journal' },
	{ label: 'reorg', script: 'check:reorg' },
	{ label: 'reserve mempool', script: 'check:mempool-reserve' },
	{ label: 'sweep mempool', script: 'check:mempool-sweep' },
	{ label: 'paritas PoW', script: 'check:pow' },
	{ label: 'urutan nonce', script: 'check:nonce-order' },
	{ label: 'direktori data', script: 'check:data' },
	{ label: 'log berkas', script: 'check:log' },
	{ label: 'genesis', script: 'genesis:check' },
]

const runOfflinePhase = async (): Promise<void> => {
	for (const gate of OFFLINE_GATES) {
		await runGate(gate.label, gate.script)
	}
}

// ---------------------------------------------------------------------------
// Fase 2 & 3 — smoke lokal & P2P yang menyalakan node sendiri
// ---------------------------------------------------------------------------

const runLocalPhase = async (): Promise<void> => {
	await runGate('smoke wallet (lokal)', 'wallet:smoke')
}

const runP2pPhase = async (): Promise<void> => {
	await runGate('smoke P2P (tiga node lokal)', 'p2p:smoke')
	await runGate('smoke P2P fork/reorg (dua node lokal)', 'p2p:fork')
}

// ---------------------------------------------------------------------------
// Util RPC bersama
// ---------------------------------------------------------------------------

let rpcId = 0
const rpc = async <T>(
	url: string,
	method: string,
	params?: unknown,
): Promise<T> => {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++rpcId,
			method,
			...(params === undefined ? {} : { params }),
		}),
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`)
	}
	const body = (await response.json()) as {
		result?: T
		error?: { message?: string }
	}
	if (body.error) throw new Error(body.error.message ?? 'JSON-RPC error')
	return body.result as T
}

// ---------------------------------------------------------------------------
// Fase 4 — `miner:rs` terhadap node sementara (tanpa node manual)
// ---------------------------------------------------------------------------

/** Cari port TCP bebas dari OS supaya tidak bentrok dengan node dev. */
const getFreePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const server = net.createServer()
		server.unref()
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			const port = typeof address === 'object' && address ? address.port : 0
			server.close(() => resolve(port))
		})
	})

interface LiveNode {
	child: ChildProcess
	url: string
	log: () => string
}

const spawnLiveNode = (dataDir: string, port: number): LiveNode => {
	const child = spawn('bun', ['apps/node/server.ts'], {
		cwd: ROOT,
		env: {
			...process.env,
			NEX_DATA_DIR: dataDir,
			NEX_RPC_PORT: String(port),
			RPC_BIND_HOST: '127.0.0.1',
			// Kosong MENANG atas `.env` root -> loopback tanpa Basic Auth, sehingga
			// `nex_getWork`/`nex_submitWork` bisa dipanggil smoke tanpa kredensial.
			RPC_USER: '',
			RPC_PASSWORD: '',
			// Matikan P2P: node sementara ini hanya melayani RPC.
			NEX_P2P_ENABLED: '0',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let log = ''
	const capture = (chunk: unknown): void => {
		log = (log + String(chunk)).slice(-131_072)
	}
	child.stdout?.on('data', capture)
	child.stderr?.on('data', capture)
	return { child, url: `http://127.0.0.1:${port}/rpc`, log: () => log }
}

const waitReady = async (node: LiveNode): Promise<void> => {
	const deadline = Date.now() + BOOT_TIMEOUT_MS
	while (Date.now() < deadline) {
		if (node.child.exitCode !== null) {
			throw new Error(
				`node sementara keluar saat boot (exit ${node.child.exitCode})\n${node.log()}`,
			)
		}
		try {
			const blocks = await rpc<unknown[]>(node.url, 'nex_getRecentBlocks', {
				count: 1,
			})
			if (Array.isArray(blocks) && blocks.length > 0) return
		} catch {
			// RPC belum siap — coba lagi.
		}
		await delay(250)
	}
	throw new Error(
		`node sementara tidak siap dalam ${BOOT_TIMEOUT_MS / 1000}s\n${node.log()}`,
	)
}

const stopLiveNode = async (child: ChildProcess): Promise<void> => {
	if (child.exitCode !== null) return
	await new Promise<void>((done) => {
		const timer = setTimeout(done, 5_000)
		child.once('exit', () => {
			clearTimeout(timer)
			done()
		})
		child.kill()
	})
}

/** Hapus direktori temp; percobaan ulang untuk lock OS yang lambat (Windows). */
const rmWithRetry = async (dir: string): Promise<void> => {
	for (let attempt = 0; attempt < 12; attempt++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true })
			return
		} catch {
			await delay(250)
		}
	}
	console.log(`  (catatan) tidak bisa menghapus ${dir} — dilewati`)
}

/** Alamat reward sekali pakai untuk gate (`NxC` + 40 nol) — node hanya cek format. */
const SMOKE_ADDRESS = `NxC${'0'.repeat(40)}`

/**
 * Binary miner Rust yang SUDAH dibuild, atau `null`.
 *
 * Gate sengaja tidak memanggil `cargo`: toolchain Rust tidak ada di semua
 * mesin (lihat AGENTS.md), dan build di dalam gate akan menambah menit.
 * Tanpa binary, fase ini dilewati dengan peringatan — bukan gagal.
 */
const findMinerBinary = (): string | null => {
	const name = process.platform === 'win32' ? 'nex-miner.exe' : 'nex-miner'
	const bin = path.join(ROOT, 'apps', 'miner-rs', 'target', 'release', name)
	return fs.existsSync(bin) ? bin : null
}

const runLivePhase = async (): Promise<void> => {
	const bin = findMinerBinary()
	if (bin === null) {
		console.warn(
			'  (dilewati) binary miner Rust belum ada — jalankan ' +
				'`cargo build --release` di apps/miner-rs untuk mengaktifkan gate ini',
		)
		return
	}
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-checkall-'))
	const port = await getFreePort()
	const node = spawnLiveNode(dataDir, port)
	console.log(`node sementara: ${node.url}\n  data dir: ${dataDir}`)
	try {
		await waitReady(node)
		console.log('  node siap (genesis tertulis)')
		gateIndex++
		console.log(
			`\n──────── [${gateIndex}] miner Rust --once (node sementara) ────────`,
		)
		const startedAt = Date.now()
		const env = childEnv()
		// Node sementara tanpa kredensial: jangan biarkan env shell mengirim
		// Basic Auth yang tidak diminta.
		delete env.NEX_RPC_USER
		delete env.NEX_RPC_PASS
		const code = await new Promise<number>((resolve) => {
			const child = spawn(
				bin,
				[
					'--once',
					'--rpc',
					node.url,
					'--address',
					SMOKE_ADDRESS,
					'--threads',
					'1',
				],
				{ cwd: ROOT, env, stdio: 'inherit' },
			)
			child.once('error', () => resolve(1))
			child.once('exit', (exitCode) => resolve(exitCode ?? 1))
		})
		const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
		if (code !== 0) {
			throw new Error(`miner Rust --once gagal (exit ${code}, ${secs}s)`)
		}
		console.log(`✓ miner Rust --once (${secs}s)`)
	} finally {
		await stopLiveNode(node.child)
		await rmWithRetry(dataDir)
	}
}

// ---------------------------------------------------------------------------
// Fase 5 — `explorer smoke` terhadap node yang sudah ada (>= 5 blok)
// ---------------------------------------------------------------------------

/** Baca `VITE_RPC_URL` dari `explorer/.env`, kalau ada. */
const readExplorerEnvUrl = (): string | null => {
	try {
		const raw = fs.readFileSync(path.join(ROOT, 'explorer', '.env'), 'utf8')
		for (const line of raw.split(/\r?\n/)) {
			const match = /^\s*VITE_RPC_URL\s*=\s*(.*)$/.exec(line)
			const value = match?.[1]?.trim().replace(/^["']|["']$/g, '')
			if (value) return value
		}
	} catch {
		// Tidak ada explorer/.env — bukan error.
	}
	return null
}

const resolveExplorerUrl = (): string | null => {
	const explicit = process.env.NEX_EXPLORER_RPC_URL?.trim()
	if (explicit) return explicit
	return readExplorerEnvUrl()
}

const runExplorerPhase = async (): Promise<void> => {
	const url = resolveExplorerUrl()
	if (!url) {
		console.log(
			'\n↷ LEWATI smoke explorer — tidak ada URL node.\n' +
				'  Set `NEX_EXPLORER_RPC_URL` atau `VITE_RPC_URL` di explorer/.env.',
		)
		return
	}

	let blockCount: number
	try {
		const recent = await rpc<unknown[]>(url, 'nex_getRecentBlocks', {
			count: EXPLORER_MIN_BLOCKS,
		})
		blockCount = Array.isArray(recent) ? recent.length : 0
	} catch (error) {
		console.log(
			`\n↷ LEWATI smoke explorer — node ${url} tidak terjangkau ` +
				`(${error instanceof Error ? error.message : String(error)}).`,
		)
		return
	}

	if (blockCount < EXPLORER_MIN_BLOCKS) {
		console.log(
			`\n↷ LEWATI smoke explorer — node ${url} baru punya ${blockCount} blok ` +
				`(butuh >= ${EXPLORER_MIN_BLOCKS}).`,
		)
		return
	}

	await runGate('smoke explorer (node yang ada)', 'smoke', {
		cwd: path.join(ROOT, 'explorer'),
		env: childEnv({ VITE_RPC_URL: url }),
	})
}

// ---------------------------------------------------------------------------
// Orkestrasi
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
	const startedAt = Date.now()
	console.log('check:all — gerbang semua test')
	console.log(`fase: ${phases.join(', ')}${FAST ? ' (NEX_CHECK_FAST=1)' : ''}`)

	if (wants('offline')) await runOfflinePhase()
	if (wants('local')) await runLocalPhase()
	if (wants('p2p')) await runP2pPhase()
	if (wants('live')) await runLivePhase()
	if (wants('explorer')) await runExplorerPhase()

	const total = ((Date.now() - startedAt) / 1000).toFixed(1)
	console.log(`\n✓ SEMUA GERBANG LULUS — ${gateIndex} gate, ${total}s`)
}

main().catch((error: unknown) => {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`)
	console.error('\nPush dibatalkan. Perbaiki dulu, atau lewati dengan:')
	console.error('  git push --no-verify              (lewati semua hook)')
	console.error(
		'  HUSKY=0 git push                  (matikan husky sekali ini)',
	)
	console.error(
		'  NEX_CHECK_FAST=1 bun run check:all (jalankan hanya gate offline)',
	)
	process.exit(1)
})
