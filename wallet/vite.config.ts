import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Modul backend root yang di-ALIAS — bukan diduplikasi.
 *
 * Logika sign/vault/validasi (Phase A–E) adalah bagian paling mahal dari
 * proyek ini; UI hanya MENYUSUN ulang modul yang sama, sehingga perilaku
 * wallet dijamin identik dengan node/CLI yang sudah teruji gate.
 *
 * Berbeda dari `wallet-ext/` (yang sudah dihapus, memakai *vendor snapshot*),
 * wallet ini mengalias langsung ke root `src/`. Itu bisa dilakukan karena ia
 * di-build di dalam repo ini, bukan diunggah ke toko ekstensi yang menuntut
 * kemandirian. Konsekuensinya: TIDAK ADA salinan logika crypto, jadi tidak ada
 * risiko salinan crypto tertinggal saat modul di root diperbaiki.
 */
const ROOT_MODULES = [
	'src/core',
	'src/crypto',
	'src/types',
	'src/client',
	'src/rpc',
	'src/logging',
] as const

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
	.replace(/\\/g, '/')
	.replace(/\/+$/, '')

/**
 * Tiga target build dari SATU konfigurasi.
 *
 *   VITE_TARGET=dev      → shell developer (vault memori, port 5174)
 *   VITE_TARGET=desktop  → shell desktop (vault berkas, diisi Electron/Tauri)
 *
 * Semua target memakai `src/` yang SAMA (sembilan layar, logika vault). Yang
 * berbeda hanya entry HTML dan backend yang disuntikkan shell.
 *
 * Catatan: target `ext` sudah dipensiunkan — ekstensi Chrome tidak lagi
 * didukung. Lihat catatan di AGENTS.md.
 */
type Target = 'dev' | 'desktop'

const TARGET_ENTRY: Record<Target, string> = {
	dev: 'shells/dev/index.html',
	desktop: 'shells/desktop/index.html',
}

const resolveTarget = (mode: string): Target =>
	mode === 'desktop' || process.env.VITE_TARGET === 'desktop'
		? 'desktop'
		: 'dev'

export default defineConfig(({ mode }) => {
	const target = resolveTarget(mode)

	return {
		/**
		 * `.env` OPSIONAL — dan idealnya tidak ada sama sekali.
		 *
		 * Semua nilai punya default yang benar untuk pemakaian normal:
		 *   - URL RPC     : shell yang menentukan (desktop lewat bridge,
		 *                   dev lewat localhost:8000). Lihat `src/lib/rpcUrl.ts`.
		 *   - Explorer    : kosong = link eksternal dimatikan.
		 *   - Backend vault: desktop menyuntik backend berkas sendiri; dev
		 *                   memakai memori. Lihat `src/lib/vaultStore.ts`.
		 *
		 * Yang PENTING di sini: jangan biarkan Vite memuat `.env` dari root
		 * repo. Repo ini adalah monorepo — root `.env` berisi rahasia NODE
		 * (`NEX_CHAIN_ID`, bind host, dll) yang tidak ada hubungannya dengan
		 * build wallet, dan memuatnya membuat hasil build bergantung pada
		 * berkas yang seharusnya diabaikan git.
		 *
		 * Bila seseorang memang ingin override, taruh `.env` DI DALAM
		 * `wallet/` (folder ini) — bukan di root repo.
		 */
		envDir: fileURLToPath(new URL('.', import.meta.url)),
		/**
		 * Target `desktop` dijalankan Electron lewat `file://`, jadi URL aset
		 * HARUS relatif. Default Vite (`/assets/…`) menunjuk ke akar drive
		 * (`file:///C:/assets/…`) dan membuat renderer memuat halaman kosong —
		 * #root tetap kosong tanpa error yang jelas. `base: './'` menulis
		 * `./assets/…` sehingga berkas benar-benar ditemukan.
		 */
		base: target === 'desktop' ? './' : '/',
		resolve: {
			alias: [
				// 'buffer' DIPAKSA ke paket npm: Node builtin tidak ada di browser,
				// dan bip39 (mnemonic/seed) memanggil Buffer.from. Resolusi ambigu
				// antara builtin vs paket dicegah di sini supaya bundle selalu
				// membawa implementasi JS murni.
				{
					find: /^buffer$/,
					replacement: fileURLToPath(
						new URL('./node_modules/buffer/index.js', import.meta.url),
					),
				},
				// @ alias untuk src/ directory
				{
					find: /^@\//,
					replacement: fileURLToPath(new URL('./src/', import.meta.url)),
				},
				...ROOT_MODULES.map((m) => ({
					find: new RegExp(`^${m}/`),
					replacement: `${repoRoot}/${m}/`,
				})),
			],
		},
		// JSX runtime otomatis (react/jsx-runtime) tanpa @vitejs/plugin-react —
		// mengikuti pola explorer: transform esbuild cukup untuk build benar.
		esbuild: { jsx: 'automatic' },
		server: {
			port: 5174,
			// File backend ada di LUAR root wallet → izinkan dev server
			// menyajikannya (default Vite memblokir path di luar root).
			fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
		},
		build: {
			outDir: `dist/${target}`,
			sourcemap: false,
			// Worker ikut dibundel; entri utama ditentukan target.
			rollupOptions: {
				input: {
					main: TARGET_ENTRY[target],
					cryptoWorker: 'src/workers/crypto.worker.ts',
				},
			},
		},
		// Worker format ES untuk mendukung code splitting
		worker: {
			format: 'es',
		},
	}
})
