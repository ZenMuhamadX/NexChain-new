/**
 * STUB writeLog untuk wallet-ext.
 * PENTING: `logError` di sini mengembalikan `false` (BUKAN void) karena
 * dipakai sebagai nilai balik di jalur validasi — mis.
 * `return logError(...)` di `clientValidateTx`. Mengembalikan void akan
 * membuat validator mengembalikan undefined dan transaksi tidak pernah lolos.
 */
export const logError = (..._args: unknown[]): boolean => false
export const writeLog = (..._args: unknown[]): void => {}
