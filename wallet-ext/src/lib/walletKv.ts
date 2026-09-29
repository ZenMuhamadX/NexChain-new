import type { WalletKV } from 'client/wallet/kv'
import { traceNote, traceWarn } from './trace'

/**
 * Backend penyimpanan vault KHUSUS Chrome Extension.
 *
 * KENAPA BUKAN IndexedDB:
 *   - Di beberapa konfigurasi Chrome (kebijakan enterprise, mode privasi,
 *     profil dengan storage dibatasi, headless sandbox), `openDB` tidak
 *     pernah resolve/reject → `getVault()` menggantung → popup macet di
 *     splash "Menyiapkan vault lokal…".
 *   - Bahkan dengan timeout saat membuka, jalur IndexedDB + fallback +
 *     worker init bisa melampaui 15 detik dan memicu failsafe
 *     "Penyimpanan tidak merespons" — padahal `chrome.storage.local`
 *     sebenarnya sehat.
 *   - Karena itu IndexedDB sudah DIHAPUS TOTAL dari extension ini: tidak ada
 *     `openDB`, tidak ada bundle `idb`, tidak ada `client/wallet/idbKv` di
 *     vendor (`scripts/snapshotVendor.ts` sengaja tidak menyalinnya).
 *
 * `chrome.storage.local` adalah storage RESMI MV3: persist, terbagi antar
 * konteks extension (popup/background/tab), promise-based, tanpa quota
 * issue pada ukuran wallet (~1 KB). Karena vault menyimpan SATU record
 * kecil, tidak ada alasan memaksakan IndexedDB di extension.
 *
 * localStorage hanya fallback dev (bukan konteks extension).
 *
 * Prefix kunci (`nexvault:`) sengaja dipertahankan supaya data lama yang
 * mungkin pernah tersimpan di chrome.storage tetap ditemukan.
 */
const PREFIX = 'nexvault:'

const hasChromeStorage = (): boolean =>
	typeof chrome !== 'undefined' && !!chrome.storage?.local

/** Lapisan 1: chrome.storage.local (MV3). Sinkron membuat KV; method async. */
const createChromeStorageKV = (): WalletKV => {
	traceNote('walletKv: memakai chrome.storage.local')
	const area = chrome.storage.local
	return {
		get: async <T>(key: string): Promise<T | undefined> => {
			const full = PREFIX + key
			traceNote(`walletKv.get(${full}) …`)
			const result = await area.get(full)
			traceNote(`walletKv.get(${full}) ✓`)
			return result[full] as T | undefined
		},
		set: async <T>(key: string, value: T): Promise<void> => {
			traceNote(`walletKv.set(${PREFIX + key}) …`)
			await area.set({ [PREFIX + key]: value })
			traceNote(`walletKv.set(${PREFIX + key}) ✓`)
		},
		delete: async (key: string): Promise<void> => {
			traceNote(`walletKv.delete(${PREFIX + key}) …`)
			await area.remove(PREFIX + key)
			traceNote(`walletKv.delete(${PREFIX + key}) ✓`)
		},
	}
}

/** Lapisan 2: localStorage (dev / halaman biasa, BUKAN extension). */
const createLocalStorageKV = (): WalletKV | undefined => {
	if (typeof localStorage === 'undefined') {
		traceWarn('walletKv: localStorage tidak ada')
		return undefined
	}
	try {
		// Probe: sebagian konteks melempar saat diakses.
		localStorage.getItem(PREFIX + '__probe')
	} catch (error) {
		traceWarn('walletKv: localStorage tidak bisa diakses', String(error))
		return undefined
	}
	traceNote('walletKv: memakai localStorage (fallback dev)')
	return {
		get: async <T>(key: string): Promise<T | undefined> => {
			const raw = localStorage.getItem(PREFIX + key)
			if (raw === null) return undefined
			try {
				return JSON.parse(raw) as T
			} catch {
				return undefined
			}
		},
		set: async <T>(key: string, value: T): Promise<void> => {
			localStorage.setItem(PREFIX + key, JSON.stringify(value))
		},
		delete: async (key: string): Promise<void> => {
			localStorage.removeItem(PREFIX + key)
		},
	}
}

/**
 * Pilih backend pertama yang tersedia.
 *
 * Urutan PENTING: `chrome.storage.local` selalu dicoba dulu di konteks
 * extension. Tidak ada penantian IndexedDB yang bisa memicu failsafe.
 * Fungsi ini sepenuhnya sinkron — pemanggil tidak perlu `await` (meskipun
 * await pada nilai non-Promise tidak masalah).
 */
export const createExtensionKV = (): WalletKV => {
	if (hasChromeStorage()) return createChromeStorageKV()
	traceWarn('walletKv: chrome.storage.local TIDAK terdeteksi')
	const local = createLocalStorageKV()
	if (local) return local
	throw new Error(
		'Tidak ada penyimpanan yang tersedia (chrome.storage.local dan localStorage gagal).',
	)
}