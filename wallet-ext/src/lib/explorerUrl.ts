import { storageGet, storageSet } from './storage'

/**
 * Base URL Explorer untuk CHROME EXTENSION.
 *
 * Karena `chrome.storage` bersifat async, nilai disimpan dalam CACHE memori
 * setelah `loadExplorerUrl()` dipanggil sekali saat boot. Getter sinkron
 * (`getExplorerUrl()`) tetap dipertahankan supaya komponen UI tidak perlu
 * diubah menjadi async.
 */
const STORAGE_KEY = 'explorer_url'
const DEV_FALLBACK = 'http://localhost:5173'

let cached: string | undefined

const normalizeBase = (value: string | undefined): string => {
	const raw = value?.trim()
	if (!raw) return ''
	if (raw.startsWith('/')) return raw.replace(/\/+$/, '')
	try {
		const parsed = new URL(raw)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
		return raw.replace(/\/+$/, '')
	} catch {
		return ''
	}
}

const envBase = (): string => normalizeBase(import.meta.env.VITE_EXPLORER_URL)

/** Muat nilai dari chrome.storage ke cache — panggil sekali saat boot. */
export const loadExplorerUrl = async (): Promise<void> => {
	try {
		const saved = await storageGet(STORAGE_KEY)
		cached = normalizeBase(saved ?? undefined) || undefined
	} catch {
		cached = undefined
	}
}

/** Base URL explorer: cache (Settings) → build-time env → dev fallback. */
export const getExplorerUrl = (): string =>
	cached || envBase() || (import.meta.env.DEV ? DEV_FALLBACK : '')

export const persistExplorerUrl = async (value: string): Promise<string> => {
	const normalized = normalizeBase(value)
	if (value.trim() && !normalized) {
		throw new Error('URL explorer harus berupa http(s) URL atau path yang diawali /.')
	}
	cached = normalized || undefined
	await storageSet(STORAGE_KEY, normalized)
	return normalized
}

const withPath = (base: string, path: string): string =>
	base ? `${base}${path}` : ''

export const explorerTxUrl = (hash: string, base = getExplorerUrl()): string =>
	withPath(base, `/tx/${encodeURIComponent(hash)}`)

export const explorerAddressUrl = (
	address: string,
	base = getExplorerUrl(),
): string => withPath(base, `/address/${encodeURIComponent(address)}`)

export const explorerMempoolUrl = (base = getExplorerUrl()): string =>
	withPath(base, '/mempool')

export const explorerBlocksUrl = (base = getExplorerUrl()): string =>
	withPath(base, '/blocks')
