/**
 * Pola klasifikasi input pencarian — meniru `isValidAddress` backend v0.1:
 * `NxC` + 40 hex huruf kecil = 43 karakter.
 *
 * Prefiks `NxS` dan tag byte alamat SUDAH TIDAK ADA (v0.1), jadi pola lama
 * `/^Nx[CS].{40}$/` menerima alamat yang tidak akan pernah dikenali node —
 * pencariannya berakhir di halaman "invalid address" tanpa menjelaskan apa
 * pun. `.{40}` juga menerima karakter non-hex, sehingga salah ketik lolos
 * sebagai "alamat".
 *
 * `TX_HASH_PATTERN` meniru `src/core/encoding/rlp/txHash.ts` (`isTxHash`):
 * `txHash` berbentuk `TxC` + 64 hex = 67 karakter, BUKAN 64 hex. Explorer
 * sengaja TIDAK mengimpor modul backend (file backend tidak ikut bundle),
 * jadi pola disalin di sini — samakan bila prefix kanonik berubah.
 */
export const ADDRESS_PATTERN = /^NxC[0-9a-f]{40}$/
export const HEIGHT_PATTERN = /^\d+$/
export const HASH_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/
export const TX_HASH_PATTERN = /^TxC[0-9a-f]{64}$/

export type QueryKind = 'height' | 'address' | 'hash' | 'unknown'

/** Prefix kanonik (`NxC`/`TxC`) dipertahankan, bagian hex jadi lowercase. */
export function normalizeQuery(query: string): string {
	const trimmed = query.trim()
	if (/^NxC/i.test(trimmed)) return `NxC${trimmed.slice(3).toLowerCase()}`
	if (/^TxC/i.test(trimmed)) return `TxC${trimmed.slice(3).toLowerCase()}`
	return trimmed.toLowerCase()
}

export function classifyQuery(query: string): QueryKind {
	// Alamat/hash dari user (termasuk salinan checksum MetaMask) dinormalkan
	// ke lowercase; pola kanoniknya tetap lowercase.
	const normalized = normalizeQuery(query)
	if (ADDRESS_PATTERN.test(normalized)) return 'address'
	// Hash dulu sebelum height: string64 digit murni bisa jadi hash.
	// `hash` mencakup hash blok (64 hex) DAN hash tx (`TxC` + 64 hex); resolver
	// mencoba blok dulu lalu transaksi, jadi kedua bentuk ditangani.
	if (HASH_PATTERN.test(normalized) || TX_HASH_PATTERN.test(normalized))
		return 'hash'
	if (HEIGHT_PATTERN.test(normalized)) return 'height'
	return 'unknown'
}
