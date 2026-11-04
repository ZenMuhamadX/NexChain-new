import { wordlists } from 'bip39'

/**
 * Kata BIP39 Inggris — satu-satunya wordlist yang dipakai wallet:
 * `genRandomMnemonic` memanggil `generateMnemonic(128)` dengan default Inggris.
 *
 * Dipakai dua hal: saran saat mengetik, dan penanda kata yang salah eja.
 * (Akses `bip39` -> `_wordlists` sudah ada di bundle lewat generate/validate,
 * jadi daftar ini tidak menambah modul baru.)
 */
export const MNEMONIC_WORDLIST: readonly string[] = wordlists.english ?? []

const known = new Set(MNEMONIC_WORDLIST)

export const isKnownWord = (word: string): boolean => known.has(word)

/** Maksimal saran yang ditampilkan agar daftar tidak menutupi form. */
export const MAX_SUGGESTIONS = 6

/**
 * Saran untuk kata yang sedang diketik.
 *
 * Kosong bila query kosong atau sudah cocok persis — menampilkan `abandon`
 * untuk kata `abandon` yang utuh hanya mengganggu. Pencarian linear 2048 kata
 * cukup murah untuk setiap ketikan.
 */
export const suggestWords = (
	query: string,
	limit: number = MAX_SUGGESTIONS,
): string[] => {
	const word = query.trim().toLowerCase()
	if (word === '' || known.has(word)) return []
	const matches: string[] = []
	for (const candidate of MNEMONIC_WORDLIST) {
		if (!candidate.startsWith(word)) continue
		matches.push(candidate)
		if (matches.length >= limit) break
	}
	return matches
}

/**
 * Pecah teks tempelan menjadi kata: huruf kecil, spasi/baris baru dirapikan.
 * Dipakai saat satu kotak menerima frasa utuh (tempel dari password manager).
 */
export const splitMnemonic = (text: string): string[] =>
	text
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => word !== '')

/** Isi satu kotak: hanya huruf kecil, tanpa spasi/angka. */
export const normalizeWord = (text: string): string =>
	text.toLowerCase().replace(/[^a-z]/g, '')
