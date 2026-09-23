/**
 * Pola klasifikasi input pencarian — sengaja meniru `isValidAddress`
 * backend (prefix NxS/NxC + panjang 43), bukan asumsi hex.
 */
export const ADDRESS_PATTERN = /^Nx[CS].{40}$/
export const HEIGHT_PATTERN = /^\d+$/
export const HASH_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/

export type QueryKind = 'height' | 'address' | 'hash' | 'unknown'

export function classifyQuery(query: string): QueryKind {
	if (ADDRESS_PATTERN.test(query)) return 'address'
	// Hash dulu sebelum height: string64 digit murni bisa jadi hash.
	if (HASH_PATTERN.test(query)) return 'hash'
	if (HEIGHT_PATTERN.test(query)) return 'height'
	return 'unknown'
}
