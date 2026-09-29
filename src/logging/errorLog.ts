import { logToConsole } from './logging'

// Define ErrorInfo interface
interface ErrorInfo {
	timestamp: number
	level: 'error'
	message: string
	context: string
	stack: string
	priority: 'low' | 'high'
	hint?: string
}

/**
 * Deteksi runtime Node (bukan browser).
 *
 * Penting: fs/path/winston di-import SECARA DINAMIS dan hanya saat kita di
 * Node. Versi sebelumnya memakai import statis + fs.mkdirSync saat module
 * load, sehingga modul ini ikut menarik `fs`/`path` ke bundler browser
 * (error: "Module fs has been externalized for browser compatibility").
 */
const isNodeRuntime = (): boolean =>
	typeof process !== 'undefined' && typeof window === 'undefined'

type FileLogger = { info: (msg: unknown) => void }

let fileLogger: FileLogger | null = null
let initStarted = false

// Error yang datang sebelum file logger siap ditampung sementara (hanya di Node).
const pending: unknown[] = []
const MAX_PENDING = 200

/** Modul yang HANYA boleh dimuat di Node. */
const NODE_MODULE = {
	winston: 'winston',
	path: 'path',
	fs: 'fs',
} as const

type NodeModuleName = keyof typeof NODE_MODULE

/**
 * Dynamic import dengan specifier TIDAK literal.
 *
 * Sengaja begitu: bundler browser (vite/esbuild) tidak bisa menganalisis
 * argumennya, sehingga winston beserta dependensi Node-nya (fs, path, util,
 * os, zlib, http, ...) TIDAK ikut masuk ke bundle wallet. Tanpa trik ini
 * bundling browser gagal dengan "Could not resolve fs".
 * Di Node/Bun pemanggilan ini tetap meresolve normal dari node_modules.
 */
const importNodeModule = (name: NodeModuleName): Promise<any> =>
	import(/* @vite-ignore */ NODE_MODULE[name])

/**
 * Buat file logger secara lazy, hanya di Node.
 * Bersifat best-effort: kegagalan membuat log file tidak boleh mematikan proses.
 */
const ensureFileLogger = (): void => {
	if (initStarted || !isNodeRuntime()) return
	initStarted = true

	void (async () => {
		try {
			const winston = (await importNodeModule('winston')).default
			const path = (await importNodeModule('path')).default
			const fs = (await importNodeModule('fs')).default

			const logDirPath = path.join(__dirname, '../logs')
			if (!fs.existsSync(logDirPath)) {
				fs.mkdirSync(logDirPath, { recursive: true })
			}

			const logger = winston.createLogger({
				level: 'error',
				format: winston.format.json(),
				transports: [
					new winston.transports.File({
						filename: path.join(logDirPath, 'error_log.log'),
					}),
					new winston.transports.Console({
						format: winston.format.printf((info: unknown) =>
							JSON.stringify(info),
						),
					}),
				],
			})

			fileLogger = logger as unknown as FileLogger

			// flush error yang masuk sebelum logger siap
			while (pending.length > 0) {
				fileLogger.info(pending.shift())
			}
		} catch {
			fileLogger = null
			pending.length = 0
		}
	})()
}

// Function to log errors. Sign-nya TETAP sync agar tidak mengubah caller.
export const loggingErr = (err: ErrorInfo): void => {
	if (!err) return

	const { priority, ...logMessage } = err

	ensureFileLogger()

	if (fileLogger) {
		fileLogger.info(logMessage)
	} else if (isNodeRuntime() && pending.length < MAX_PENDING) {
		pending.push(logMessage)
	}
	// Di browser: tidak ada file log, cukup console di bawah.

	// Display only high-priority errors in the console
	if (priority === 'high') {
		console.error(logMessage)
	} else {
		logToConsole('Non-critical error logged to file.')
	}
}
