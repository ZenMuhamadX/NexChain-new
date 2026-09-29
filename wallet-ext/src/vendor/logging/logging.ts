/**
 * STUB logging untuk wallet-ext.
 * Modul core mengimpornya, tetapi implementasi asli memakai winston/chalk
 * (Node-only) dan TIDAK dipakai jalur browser. Stub ini menjaga API minimal
 * sebagai no-op agar bundel browser tetap bebas Node.
 */
export const logToConsole = (..._args: unknown[]): void => {}
export const logToFile = (..._args: unknown[]): void => {}
export const logger = {
	info: (..._a: unknown[]): void => {},
	error: (..._a: unknown[]): void => {},
}
