import fs from 'fs'
import path from 'path'
import { dataPath } from './dataDir'

/**
 * Node memakai SATU LevelDB. Setiap store lama kini hanya namespace/key
 * prefix di dalam database `chain` ini (lihat `chain.ts`).
 */
const DATA_SUBDIRS = ['chain']

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
 * Pastikan direktori data siap dipakai. Idempoten dan fail-closed: node yang
 * tidak bisa menyimpan data harus berhenti di awal, bukan menyimpulkan rantai
 * kosong lalu menulis genesis baru di atas data yang sebenarnya ada.
 */
export const initFile = (): void => {
	if (initialized) return
	initialized = true

	try {
		for (const name of DATA_SUBDIRS) {
			fs.mkdirSync(dataPath(name), { recursive: true })
		}
		probeWritable(dataPath('chain'))
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Direktori data "${dataPath('chain')}" tidak dapat disiapkan (${reason}). ` +
				'Periksa NEX_DATA_DIR dan izin folder.',
		)
	}
}
