const STORAGE_KEY = 'wallet-new.explorer'

/** Public explorer used when neither Settings nor the build env overrides it. */
export const DEFAULT_EXPLORER_URL = 'https://explorer.zuns.my.id'

const normalizeBase = (value: string | undefined): string => {
	const raw = value?.trim()
	if (!raw) return ''
	try {
		const parsed = new URL(raw)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
		return raw.replace(/\/+$/, '')
	} catch {
		return ''
	}
}

/** Settings override → build-time env → public default. */
export const getExplorerUrl = (): string => {
	try {
		const saved = normalizeBase(localStorage.getItem(STORAGE_KEY) ?? undefined)
		if (saved) return saved
	} catch {
		// localStorage can be unavailable in restricted contexts.
	}
	return (
		normalizeBase(import.meta.env.VITE_EXPLORER_URL) || DEFAULT_EXPLORER_URL
	)
}

export const persistExplorerUrl = (value: string): string => {
	const normalized = normalizeBase(value)
	if (value.trim() && !normalized) {
		throw new Error('Explorer URL must be an http(s) URL.')
	}
	try {
		if (normalized) localStorage.setItem(STORAGE_KEY, normalized)
		else localStorage.removeItem(STORAGE_KEY)
	} catch {
		// Keep the in-memory/default value even if persistence is blocked.
	}
	return normalized
}

export const explorerTxUrl = (hash: string, base = getExplorerUrl()): string =>
	base ? `${base}/tx/${encodeURIComponent(hash)}` : ''
