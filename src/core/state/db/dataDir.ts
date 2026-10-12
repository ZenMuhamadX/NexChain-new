import path from 'path'

/**
 * Satu-satunya sumber lokasi penyimpanan data node (LevelDB).
 *
 * Urutan penentuan:
 *   1. `NEX_DATA_DIR` bila diset — absolut, atau relatif terhadap cwd.
 *   2. `<cwd>/data` bila tidak diset.
 *
 * SENGAJA **tidak** memakai `__dirname`.
 *
 * `__dirname` adalah folder *berkas sumber* yang sedang dieksekusi, bukan
 * folder tempat operator menjalankan node. Konsekuensinya:
 *   - lokasi data ikut bergeser bila kode dipindah, di-bundle, atau dijalankan
 *     dari hasil build — dan node akan membuka rantai KOSONG di lokasi baru,
 *     diam-diam, seolah rantai lama hilang;
 *   - data ikut berada di dalam source tree, sehingga `git clean -fdx`,
 *     rsync repo, atau indexer editor bisa menyentuhnya.
 *
 * `process.cwd()` + env membuat lokasi data stabil dan bisa dikendalikan
 * operator, dan menaruhnya di luar source tree.
 */

/** Nama variabel lingkungan yang meng-override lokasi data. */
export const DATA_DIR_ENV = 'NEX_DATA_DIR'

/** Nama folder default, relatif terhadap cwd. */
export const DEFAULT_DATA_DIR_NAME = 'data'

/**
 * Hitung lokasi akar data. Dipisah dari `DATA_DIR` supaya bisa diuji dengan
 * env & cwd yang diinjeksi tanpa harus mengubah proses.
 *
 * `path.resolve` membuat nilai absolut apa adanya dan menyelesaikan nilai
 * relatif terhadap `cwd`.
 */
export const resolveDataDir = (
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
): string => {
	const configured = env[DATA_DIR_ENV]?.trim()
	if (configured) return path.resolve(cwd, configured)
	return path.resolve(cwd, DEFAULT_DATA_DIR_NAME)
}

/** Lokasi akar data untuk proses ini, dihitung sekali saat modul dimuat. */
export const DATA_DIR: string = resolveDataDir()

/** Bangun path di dalam akar data, mis. `dataPath('block')`. */
export const dataPath = (...segments: string[]): string =>
	path.join(DATA_DIR, ...segments)
