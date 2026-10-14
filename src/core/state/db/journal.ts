import { initFile } from './init'
import { dataPath } from './dataDir'
import { Level } from 'level'

initFile()
const dirPath = dataPath('journal')

/**
 * Store LevelDB KHUSUS undo journal (write-ahead log untuk rollback/reorg).
 *
 * Satu record per blok yang di-commit: `journal:<height>` = `{ hash, height,
 * entries }` (lihat `src/core/state/journal/`). Nilai lama tiap kunci yang
 * disentuh blok disimpan di sini SEBELUM tulisan state/history/block, sehingga
 * blok bisa dibalik persis saat reorg atau saat crash (boot recovery).
 *
 * `valueEncoding: 'json'` — record berupa objek; `prev` di dalamnya selalu
 * string (nilai mentah yang tersimpan) atau null (kunci belum ada → del).
 */
export const rocksJournal = new Level(dirPath, {
	valueEncoding: 'json',
	keyEncoding: 'utf-8',
	cacheSize: 4 * 1024 * 1024,
	writeBufferSize: 16 * 1024 * 1024,
	blockSize: 16384,
	compression: false,
	createIfMissing: true,
	errorIfExists: false,
	maxOpenFiles: 2048,
	maxFileSize: 1024 * 1024 * 1024,
	blockRestartInterval: 16,
	multithreading: false,
	prefix: 'leveldb-Journal',
	version: '^8.0.0',
})
