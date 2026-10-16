const STORAGE_KEY = 'nex_explorer_url'
const DEV_FALLBACK = 'http://localhost:5173'

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

/** Base URL explorer: Settings override → build-time env → local dev fallback. */
export const getExplorerUrl = (): string => {
	try {
		const saved = normalizeBase(localStorage.getItem(STORAGE_KEY) ?? undefined)
		if (saved) return saved
	} catch {
		// localStorage can be unavailable in private/restricted contexts.
	}
	return envBase() || (import.meta.env.DEV ? DEV_FALLBACK : '')
}

export const persistExplorerUrl = (value: string): string => {
	const normalized = normalizeBase(value)
	if (value.trim() && !normalized) {
		throw new Error('URL explorer harus berupa http(s) URL atau path yang diawali /.')
	}
	try {
		if (normalized) localStorage.setItem(STORAGE_KEY, normalized)
		else localStorage.removeItem(STORAGE_KEY)
	} catch {
		// Keep the in-memory/build-time value even if persistence is blocked.
	}
	return normalized
}

const withPath = (base: string, path: string): string =>
	base ? `${base}${path}` : ''

export const explorerTxUrl = (hash: string, base = getExplorerUrl()): string =>
	withPath(base, `/tx/${encodeURIComponent(hash)}`)

export const explorerMempoolUrl = (base = getExplorerUrl()): string =>
	withPath(base, '/mempool')
