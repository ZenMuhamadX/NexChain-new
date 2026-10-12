import fs from 'fs'
import path from 'path'
import { DATA_DIR, dataPath } from './dataDir'

/**
 * Sub-direktori data node. Masing-masing adalah satu database LevelDB.
 */
const DATA_SUBDIRS = ['block', 'history', 'memPool', 'state', 'storeData']

let initialized = false

/**
 * Buktikan direktori data benar-benar bisa ditulis, bukan sekadar ada.
 *
 * `existsSync` tidak cukup: direktori bisa ada tapi read-only, atau berada di
 * mount yang sudah hilang. Menulis lalu menghapus satu berkas probe adalah cara
 * murah untuk membuktikannya sekarang, bukan nanti saat transaksi pertama
 * ditulis.
 */
const probeWritable = (dir: string): void => {
	const probe = path.join(dir, '.write-test')
	fs.writeFileSync(probe, 'ok')
	fs.unlinkSync(probe)
}

/**
 * Pastikan direktori data siap dipakai.
 *
 * Idempoten: dipanggil oleh setiap modul DB saat impor, tetapi hanya benar-benar
 * bekerja sekali.
 *
 * FAIL-CLOSED: bila direktori data tidak bisa disiapkan atau ditulis, fungsi ini
 * MELEMPAR, bukan diam-diam lanjut. Node yang tidak bisa menyimpan data harus
 * berhenti di awal — kalau tidak, kegagalan tulis muncul jauh kemudian sebagai
 * "rantai kosong" dan berujung pada penulisan genesis baru di atas data yang
 * sebenarnya ada (lihat catatan di `apps/node/server.ts`).
 */
export const initFile = (): void => {
	if (initialized) return
	initialized = true

	try {
		for (const name of DATA_SUBDIRS) {
			fs.mkdirSync(dataPath(name), { recursive: true })
		}
		probeWritable(DATA_DIR)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Direktori data "${DATA_DIR}" tidak dapat disiapkan (${reason}). ` +
				'Periksa NEX_DATA_DIR dan izin folder.',
		)
	}
}
