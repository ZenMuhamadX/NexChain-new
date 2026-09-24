import { openDB, type IDBPDatabase } from 'idb'
import type { WalletKV } from './kv'

/**
 * Backend **IndexedDB** untuk vault wallet browser (Phase C).
 *
 * Dipilih di atas localStorage karena:
 *   - localStorage hanya sinkron dan membatasi ~5MB per origin;
 *   - IndexedDB menyimpan struct/bytes tanpa memaksa semuanya jadi satu
 *     string besar;
 *   - localStorage bisa terbaca oleh skrip mana pun di origin yang sama
 *     (injeksi pihak ketiga), sedangkan IndexedDB minimal butuh akses API
 *     eksplisit — dan isi vault di sini SUDAH ter-encrypt sebelum ditulis.
 *
 * Kunci dipakai secara out-of-line (`put(store, value, key)`), jadi object
 * store tidak memerlukan `keyPath`.
 */
const DEFAULT_DB_NAME = 'nex-wallet'
const STORE_NAME = 'kv'
const DB_VERSION = 1

/**
 * Buka (atau buat) database vault dan kembalikan `WalletKV`.
 *
 * Harus dipanggil sekali saat aplikasi wallet dimulai; instance-nya menahan
 * koneksi database, jadi jangan dibuka berulang-ulang per operasi.
 * Semua operasi hanya berjalan di browser — memanggilnya di Node/Bun akan
 * gagal karena `indexedDB` tidak ada (lihat `walletVaultCheck.ts` yang memakai
 * `createMemoryKV` untuk menguji logika yang sama).
 */
export const createIdbKV = async (
	dbName: string = DEFAULT_DB_NAME,
): Promise<WalletKV> => {
	const db: IDBPDatabase = await openDB(dbName, DB_VERSION, {
		upgrade(database) {
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME)
			}
		},
	})

	return {
		get: async <T>(key: string): Promise<T | undefined> =>
			(await db.get(STORE_NAME, key)) as T | undefined,
		set: async <T>(key: string, value: T): Promise<void> => {
			await db.put(STORE_NAME, value, key)
		},
		delete: async (key: string): Promise<void> => {
			await db.delete(STORE_NAME, key)
		},
	}
}
