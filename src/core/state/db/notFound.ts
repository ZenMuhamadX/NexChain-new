/**
 * Satu definisi "kunci tidak ada" untuk level (dipakai getAccount, blockState,
 * dan journal). Dulu disalin di tiga tempat, dan tiap salinan yang meleset
 * berarti DB error diperlakukan sebagai "belum ada" (fail-open).
 */
export const isNotFound = (error: unknown): boolean => {
	if (typeof error !== 'object' || error === null) return false
	const e = error as { code?: unknown; notFound?: unknown; name?: unknown }
	return (
		e.notFound === true ||
		e.code === 'LEVEL_NOT_FOUND' ||
		e.code === 'ERR_LEVEL_NOT_FOUND' ||
		e.name === 'NotFoundError'
	)
}
