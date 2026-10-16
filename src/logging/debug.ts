import { emit } from './fileSink'

/**
 * Cek flag --debug dengan aman.
 * process TIDAK ada di browser, jadi harus di-guard (versi lama membaca
 * process.argv di module scope -> ReferenceError di browser).
 */
const hasDebugFlag = (): boolean =>
	typeof process !== 'undefined' &&
	Array.isArray(process.argv) &&
	process.argv.includes('--debug')

/**
 * Catat pesan debug: SELALU masuk berkas, ke konsol hanya bila `--debug`.
 * @param namespace - Namespace untuk log debug (contoh: "app:main")
 * @param message - Pesan yang akan di-log
 */
export const loggingDebug = (
	namespace: string,
	message: string,
	...args: any
) => {
	const extra = (args as unknown[]).map(stringifyArg).join(' ')
	emit('debug', extra ? `${message} ${extra}` : message, {
		namespace,
		toConsole: hasDebugFlag(),
	})
}

// Satu argumen -> string: string apa adanya, sisanya JSON aman.
const stringifyArg = (arg: unknown): string => {
	if (typeof arg === 'string') return arg
	try {
		return JSON.stringify(arg) ?? String(arg)
	} catch {
		return String(arg)
	}
}
