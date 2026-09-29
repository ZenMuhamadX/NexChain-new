/**
 * Abstraksi penyimpanan untuk vault wallet browser (Phase C).
 *
 * MISI: memisahkan LOGIKA vault dari MEDIA penyimpanan supaya bisa diuji.
 *
 *   - Browser memakai `idbKv.ts` (IndexedDB lewat `idb`)
 *   - Skrip regresi memakai `createMemoryKV()` — IndexedDB TIDAK tersedia
 *     di Bun/Node, jadi tanpa abstraksi ini logika vault mustahil diuji
 *     otomatis.
 *
 * Keduanya menaruh byte yang sama, jadi perilaku yang teruji di memori
 * identik dengan perilaku di IndexedDB.
 */
export interface WalletKV {
	get<T>(key: string): Promise<T | undefined>
	set<T>(key: string, value: T): Promise<void>
	delete(key: string): Promise<void>
}

/** Backend memori — hanya untuk pengujian. */
export const createMemoryKV = (): WalletKV => {
	const store = new Map<string, unknown>()

	return {
		get: async <T>(key: string): Promise<T | undefined> =>
			store.get(key) as T | undefined,
		set: async <T>(key: string, value: T): Promise<void> => {
			store.set(key, value)
		},
		delete: async (key: string): Promise<void> => {
			store.delete(key)
		},
	}
}
