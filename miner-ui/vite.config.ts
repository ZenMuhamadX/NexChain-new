import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Modul backend root yang di-ALIAS — bukan diduplikasi.
 *
 * Miner UI hanya butuh logika konsensus (`src/core/consensus/Pow` untuk
 * `hashWithNonce` dan `src/core/consensus/difficulty` untuk
 * `meetsDifficulty`). Dengan meng-alias modul root, hash yang dihitung
 * browser DIJAMIN identik dengan yang diverifikasi node saat
 * `nex_submitWork` — tidak ada salinan aturan yang bisa menyimpang.
 */
const ROOT_MODULES = [
	'src/core',
	'src/crypto',
	'src/wallet',
	'src/types',
	'src/client',
	'src/rpc',
	'src/logging',
] as const

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
	.replace(/\\/g, '/')
	.replace(/\/+$/, '')

export default defineConfig({
	resolve: {
		alias: [
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
	// mengikuti pola explorer & wallet-ui: transform esbuild sudah cukup.
	esbuild: { jsx: 'automatic' },
	server: {
		port: 5175,
		// File backend ada di LUAR root miner-ui → izinkan dev server
		// menyajikannya (default Vite memblokir path di luar root).
		fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
	},
	build: {
		outDir: 'dist',
		sourcemap: false,
	},
	// Worker di-emit otomatis oleh Vite dari `new Worker(new URL(...))`
	// di `useMinerWorker.ts` — tidak perlu didaftarkan sebagai rollup input
	// terpisah (itu hanya menghasilkan chunk mati yang tak direferensikan).
	worker: {
		format: 'es',
	},
})
