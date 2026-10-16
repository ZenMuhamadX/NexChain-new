/**
 * Sink berkas terpadu untuk log node.
 *
 * Konsol tetap SEPI: baris debug hanya dicetak bila node dijalankan dengan
 * `--debug`. Berkas SELALU menerima semuanya, termasuk baris debug yang tidak
 * pernah tampil di konsol.
 *
 * Batasan browser: modul ini ikut terbundel ke wallet/miner-ui (lihat
 * scripts/browserWalletEntry.ts), jadi modul Node (fs/path) HANYA dimuat
 * lewat dynamic import dengan specifier TAK-literal (pola yang sama seperti
 * dulu di errorLog.ts) dan semua sentuhan `process` dijaga guard runtime.
 */

import chalk from 'chalk'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Nama berkas untuk tanggal tertentu, UTC. 2026-10-16 -> "nex-2026-10-16.log" */
export const logFileName = (date: Date): string =>
	`nex-${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}.log`

// Pola SGR chalk (`\x1b[...m`) plus sisa escape ANSI dua-karakter.
const ANSI_RE = new RegExp('\x1b\\[[0-9;?]*[a-zA-Z]|\x1b\\([0-9A-B]', 'g')

/** Buang semua escape ANSI (chalk). Murni. */
export const stripAnsi = (text: string): string => text.replace(ANSI_RE, '')

const LOG_NAME_RE = /^nex-(\d{4})-(\d{2})-(\d{2})\.log$/

/**
 * Nama berkas yang harus DIHAPUS. Murni, tanpa I/O.
 * Hanya nama yang cocok pola `nex-YYYY-MM-DD.log` yang dipertimbangkan.
 * days=3, now=2026-10-16 -> HAPUS tanggal <= 2026-10-13; SIMPAN 14, 15, 16.
 * Artinya: simpan `days` hari terakhir TERMASUK hari ini.
 */
export const pruneOldLogs = (
	names: string[],
	now: Date,
	days: number,
): string[] => {
	const keep = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 3
	const oldestStr = logFileName(
		new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
				(keep - 1) * 24 * 60 * 60 * 1000,
		),
	).slice(4, 14)
	return names.filter((name) => {
		if (!LOG_NAME_RE.exec(name)) return false
		return name.slice(4, 14) < oldestStr
	})
}

/** Deteksi runtime Node (bukan browser). */
const isNodeRuntime = (): boolean =>
	typeof process !== 'undefined' && typeof window === 'undefined'

/** Modul yang HANYA boleh dimuat di Node (specifier tak-literal). */
const NODE_MODULE = { fs: 'fs', path: 'path' } as const

type NodeModuleName = keyof typeof NODE_MODULE

/**
 * Dynamic import dengan specifier BUKAN literal, supaya bundler browser
 * (vite/esbuild) tidak bisa menganalisisnya dan fs/path tidak bocor ke bundle
 * wallet. Di Node/Bun pemanggilan ini tetap meresolve normal.
 */
const importNodeModule = (name: NodeModuleName): Promise<any> =>
	import(/* @vite-ignore */ NODE_MODULE[name])

type WriteFn = (...args: any[]) => boolean

let installed = false
let ready = false
let writeFailed = false
let logDirAbs = ''
let pendingDir = 'logs'
let retentionDays = 3
let lastPrunedDate = ''
let fsMod: any = null
let pathMod: any = null
let origStdoutWrite: WriteFn | null = null
let origStderrWrite: WriteFn | null = null
const outState = { text: '' }
const errState = { text: '' }

// Baris berkas yang datang sebelum sink siap ditampung sementara.
const pending: string[] = []
const MAX_PENDING = 200

/** Tanggal hari ini (UTC) sebagai "YYYY-MM-DD". */
const todayStr = (): string => logFileName(new Date()).slice(4, 14)

/** Tulis ke konsol lewat penulis ASLI (tak pernah lewat patch). */
const writeConsole = (text: string, toErr: boolean): void => {
	try {
		const orig = toErr ? origStderrWrite : origStdoutWrite
		if (orig) {
			orig(text)
			return
		}
		if (isNodeRuntime()) {
			;(toErr ? process.stderr : process.stdout).write(text)
		} else if (toErr) {
			console.error(text)
		} else {
			console.info(text)
		}
	} catch {
		// Konsol tak boleh melempar.
	}
}

/** Kunci sekali jalan: satu peringatan, lalu berhenti menulis berkas. */
const failOnce = (): void => {
	if (writeFailed) return
	writeFailed = true
	pending.length = 0
	try {
		writeConsole(
			'PERINGATAN: log berkas gagal ditulis — pencatatan berkas dimatikan.\n',
			true,
		)
	} catch {
		// Abaikan.
	}
}

/** Hapus berkas lama sesuai retensi. Gagal prune tak boleh mematikan log. */
const pruneNow = (): void => {
	try {
		const names: string[] = fsMod.readdirSync(logDirAbs)
		for (const name of pruneOldLogs(names, new Date(), retentionDays)) {
			try {
				fsMod.unlinkSync(pathMod.join(logDirAbs, name))
			} catch {
				// Lanjut ke berkas berikutnya.
			}
		}
	} catch {
		// Direktori belum siap / tak bisa dibaca — abaikan.
	}
}

/** Jalankan prune sekali saat install dan setiap ganti tanggal. */
const maybePrune = (dateStr: string): void => {
	if (dateStr === lastPrunedDate) return
	lastPrunedDate = dateStr
	pruneNow()
}

/** Tulis satu baris berkas (tanggal dihitung PER tulis, UTC). */
const appendLine = (fileLine: string): void => {
	try {
		const dateStr = todayStr()
		maybePrune(dateStr)
		fsMod.appendFileSync(
			pathMod.join(logDirAbs, `nex-${dateStr}.log`),
			`${fileLine}\n`,
		)
	} catch {
		failOnce()
	}
}

/** Ke berkas bila siap, kalau belum antre (buang tertua bila penuh). */
const queueOrWrite = (fileLine: string): void => {
	if (!isNodeRuntime() || writeFailed) return
	if (!ready || !fsMod) {
		if (pending.length >= MAX_PENDING) pending.shift()
		pending.push(fileLine)
		return
	}
	appendLine(fileLine)
}

// Satu argumen tak-string -> JSON aman (untuk baris `console.*` multi-arg).
const stringifyUnknown = (arg: unknown): string => {
	if (typeof arg === 'string') return arg
	try {
		return JSON.stringify(arg) ?? String(arg)
	} catch {
		return String(arg)
	}
}

const toFileLine = (tag: string, raw: string): string => {
	const clean = raw.endsWith('\r') ? raw.slice(0, -1) : raw
	const iso = new Date(generateTimestampz()).toISOString()
	return stripAnsi(`${iso} [${tag}] ${clean}`)
}

/** Antre teks multi-baris sebagai baris-baris berkas tersendiri. */
const queueText = (tag: string, text: string): void => {
	for (const line of text.split('\n')) queueOrWrite(toFileLine(tag, line))
}

// True selama penerusan console.* sendiri berjalan — patch stdout/stderr
// melewatkan penangkapan dalam jendela ini (di Node, console.* memanggil
// process.stdout.write, jadi tanpa flag barisnya tercatat dua kali).
let inConsoleForward = false

/**
 * Ambil modul bawaan SECARA SINKRON bila runtime menyediakannya
 * (Node 22+ / Bun). Bukan import/require — hanya string argumen, jadi
 * bundler browser tidak melihat ketergantungan modul Node di sini.
 */
const getBuiltinSync = (name: string): any => {
	try {
		const gbm = (
			process as unknown as { getBuiltinModule?: (id: string) => unknown }
		).getBuiltinModule
		if (typeof gbm !== 'function') return null
		return gbm.call(process, name) ?? null
	} catch {
		return null
	}
}

/** Siapkan direktori + prune awal; true bila sink langsung siap. */
const setupSync = (fs: any, path: any): boolean => {
	try {
		const dir = path.isAbsolute(pendingDir)
			? pendingDir
			: path.resolve(process.cwd(), pendingDir)
		fs.mkdirSync(dir, { recursive: true })
		fsMod = fs
		pathMod = path
		logDirAbs = dir
		pruneNow()
		lastPrunedDate = todayStr()
		ready = true
		for (const line of pending.splice(0)) appendLine(line)
		return true
	} catch {
		return false
	}
}
/**
 * Pasang sink berkas. Best-effort: TIDAK PERNAH melempar, dan gagal menyiapkan
 * berkas tidak boleh mematikan proses. No-op total di browser.
 */
export const installFileLogging = (options?: {
	dir?: string
	retentionDays?: number
}): void => {
	try {
		if (installed || !isNodeRuntime()) return
		installed = true

		const rawEnv = process.env.NEX_LOG_RETENTION_DAYS
		const raw =
			options?.retentionDays ?? (rawEnv === undefined ? 3 : Number(rawEnv))
		retentionDays = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 3
		pendingDir = options?.dir ?? process.env.NEX_LOG_DIR ?? 'logs'

		// Tangkap penulis ASLI dulu — emit mencetak lewat sini supaya output
		// logger tak pernah lewat patch (dedup by construction).
		origStdoutWrite = process.stdout.write.bind(process.stdout)
		origStderrWrite = process.stderr.write.bind(process.stderr)

		const patch = (
			stream: unknown,
			orig: WriteFn,
			tag: string,
			state: { text: string },
		): void => {
			const target = stream as { write: (...args: any[]) => boolean }
			target.write = (...args: any[]): boolean => {
				if (!inConsoleForward) {
					try {
						const chunk = args[0]
						const text =
							state.text + (typeof chunk === 'string' ? chunk : String(chunk))
						const parts = text.split('\n')
						state.text = parts.pop() ?? ''
						for (const line of parts) queueOrWrite(toFileLine(tag, line))
					} catch {
						// Jangan ganggu output asli.
					}
				}
				return orig.apply(stream, args)
			}
		}
		patch(process.stdout, origStdoutWrite, 'out', outState)
		patch(process.stderr, origStderrWrite, 'err', errState)

		// console.* di Bun TIDAK lewat process.stdout.write (terbukti diuji),
		// jadi teruskan juga dari sini; flag di atas yang menjaga single-catatan.
		try {
			const c = console as unknown as Record<string, (...a: any[]) => void>
			const wrap = (method: string, tag: string): void => {
				const orig = c[method].bind(console)
				c[method] = (...args: any[]): void => {
					try {
						queueText(tag, args.map(stringifyUnknown).join(' '))
					} catch {
						// Abaikan.
					}
					inConsoleForward = true
					try {
						orig(...args)
					} finally {
						inConsoleForward = false
					}
				}
			}
			wrap('log', 'out')
			wrap('info', 'out')
			wrap('debug', 'out')
			wrap('warn', 'err')
			wrap('error', 'err')
		} catch {
			// Konsol tak standar — abaikan, patch stream tetap jalan.
		}

		// Siram sisa potongan baris saat proses keluar.
		process.on('exit', () => {
			try {
				const states = [
					[outState, 'out'],
					[errState, 'err'],
				] as const
				for (const [state, tag] of states) {
					if (state.text) {
						const leftover = state.text
						state.text = ''
						queueOrWrite(toFileLine(tag, leftover))
					}
				}
			} catch {
				// Abaikan saat exit.
			}
		})

		// Jalur sinkron dulu (prune saat install benar-benar sinkron);
		// bila tak tersedia, muat asinkron dengan pola tak-literal.
		if (setupSync(getBuiltinSync('fs'), getBuiltinSync('path'))) return

		void (async () => {
			try {
				const fs = await importNodeModule('fs')
				const path = await importNodeModule('path')
				if (!setupSync(fs, path)) failOnce()
			} catch {
				failOnce()
			}
		})()
	} catch {
		// Best-effort: instalasi tak boleh melempar.
	}
}

/**
 * Tulis satu baris. SELALU ke berkas (di Node), dan ke konsol hanya bila
 * `toConsole !== false`.
 */
export const emit = (
	level: LogLevel,
	message: string,
	options?: { toConsole?: boolean; namespace?: string },
): void => {
	const iso = new Date(generateTimestampz()).toISOString()
	const ns = options?.namespace ? ` (${options.namespace})` : ''
	queueOrWrite(stripAnsi(`${iso} [${level}]${ns} ${message}`))

	if (options?.toConsole === false) return
	if (level === 'info') {
		// Format konsol info dipertahankan persis seperti dulu.
		writeConsole(
			`(${chalk.green('info')}) [${chalk.yellowBright(iso)}]: ${chalk.cyan(message)}\n`,
			false,
		)
	} else if (level === 'debug') {
		writeConsole(
			`${iso} [${options?.namespace ?? 'debug'}] ${message}\n`,
			false,
		)
	} else if (level === 'warn') {
		writeConsole(`${iso} [warn]${ns} ${message}\n`, true)
	} else {
		writeConsole(`${iso} [error]${ns} ${message}\n`, true)
	}
}
