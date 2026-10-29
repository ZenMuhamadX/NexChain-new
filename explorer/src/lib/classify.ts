/**
 * Pola klasifikasi input pencarian — sengaja meniru `isValidAddress`
 * backend (prefix NxC + panjang 43), bukan asumsi hex.
 *
 * `TX_HASH_PATTERN` meniru `src/core/encoding/rlp/txHash.ts` (`isTxHash`):
 * `txHash` berbentuk `TxC` + 64 hex = 67 karakter, BUKAN 64 hex. Explorer
 * sengaja TIDAK mengimpor modul backend (file backend tidak ikut bundle),
 * jadi pola disalin di sini — samakan bila prefix kanonik berubah.
 */
export const ADDRESS_PATTERN = /^NxC.{40}$/
export const HEIGHT_PATTERN = /^\d+$/
export const HASH_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/
export const TX_HASH_PATTERN = /^TxC[0-9a-f]{64}$/

export type QueryKind = 'height' | 'address' | 'hash' | 'unknown'

export function classifyQuery(query: string): QueryKind {
	if (ADDRESS_PATTERN.test(query)) return 'address'
	// Hash dulu sebelum height: string64 digit murni bisa jadi hash.
	// `hash` mencakup hash blok (64 hex) DAN hash tx (`TxC` + 64 hex); resolver
	// mencoba blok dulu lalu transaksi, jadi kedua bentuk ditangani.
	if (HASH_PATTERN.test(query) || TX_HASH_PATTERN.test(query)) return 'hash'
	if (HEIGHT_PATTERN.test(query)) return 'height'
	return 'unknown'
}
