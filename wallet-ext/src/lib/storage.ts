/**
 * Adapter penyimpanan untuk konteks Chrome Extension.
 *
 * Menggantikan `localStorage` (dipakai wallet-ui) karena:
 *   - `localStorage` di popup/service worker extension bersifat per-context dan
 *     tidak dibagi otomatis antar konteks extension;
 *   - `chrome.storage.local` persisten, tersinkron antar konteks extension,
 *     dan tidak terkena pembersihan storage browser biasa.
 *
 * Dipakai untuk: URL RPC, URL explorer (preferensi non-rahasia).
 * Vault (mnemonic terenkripsi) memakai `lib/walletKv.ts` dengan backend
 * `chrome.storage.local` — IndexedDB sudah dihapus total dari extension.
 */

const PREFIX = 'nex_'

const hasChromeStorage = (): boolean =>
	typeof chrome !== 'undefined' && !!chrome.storage?.local

/** Baca nilai string; `undefined` bila tidak ada / storage tidak tersedia. */
export const storageGet = async (key: string): Promise<string | undefined> => {
	const k = PREFIX + key
	if (hasChromeStorage()) {
		const result = await chrome.storage.local.get(k)
		const value = result[k]
		return typeof value === 'string' ? value : undefined
	}
	// Fallback (dev di halaman biasa / test): localStorage.
	try {
		return localStorage.getItem(k) ?? undefined
	} catch {
		return undefined
	}
}

/** Tulis nilai string. `''` berarti hapus. */
export const storageSet = async (key: string, value: string): Promise<void> => {
	const k = PREFIX + key
	if (hasChromeStorage()) {
		if (value === '') await chrome.storage.local.remove(k)
		else await chrome.storage.local.set({ [k]: value })
		return
	}
	try {
		if (value === '') localStorage.removeItem(k)
		else localStorage.setItem(k, value)
	} catch {
		// storage bisa diblokir — bukan kegagalan fatal.
	}
}

export const storageRemove = async (key: string): Promise<void> => {
	await storageSet(key, '')
}
