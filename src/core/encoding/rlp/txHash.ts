/**
 * Identitas transaksi NexChain: prefix `TxC` + 64 digit hex (total 67).
 *
 * `txHash` SENGAJA memakai prefix `TxC` supaya tidak pernah tertukar dengan
 * hash blok (64 hex telanjang) di ruang wire yang sama. Konsekuensinya
 * panjangnya **67 karakter**, jadi setiap pemeriksaan "apakah ini hash tx?"
 * WAJIB memakai `isTxHash` — bukan mengecek `length === 64`, yang secara
 * senyap selalu salah dan mematikan relay transaksi.
 *
 * Modul ini murni: tanpa crypto, tanpa Node API, tanpa I/O — supaya aman
 * dipakai lapisan P2P/protokol, kodek RLP, dan tooling uji, termasuk bundel
 * browser.
 */

/** Prefix tampilan `txHash`. Murni kosmetik — tidak ikut di-hash. */
export const TX_HASH_PREFIX = 'TxC'

/** `TxC` + 64 digit hex huruf kecil. */
const TX_HASH_PATTERN = /^TxC[0-9a-f]{64}$/

/** Benar hanya bila `value` berbentuk `TxC` + 64 hex huruf kecil. */
export const isTxHash = (value: unknown): value is string =>
	typeof value === 'string' && TX_HASH_PATTERN.test(value)
