import createDebug from 'debug'

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
 * Membuat fungsi logger berbasis namespace yang hanya aktif jika `--debug` digunakan.
 * @param namespace - Namespace untuk log debug (contoh: "app:main")
 * @param message - Pesan yang akan di-log
 */
export const loggingDebug = (
	namespace: string,
	message: string,
	...args: any
) => {
	const debug = createDebug(namespace)

	if (hasDebugFlag()) {
		createDebug.enable(namespace) // Enable specific namespace
	}

	return debug(`[${new Date().toISOString()}] ${message}`, ...args)
}
