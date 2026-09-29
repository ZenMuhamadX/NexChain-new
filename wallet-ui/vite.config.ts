import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Modul backend root yang di-ALIAS — bukan diduplikasi.
 *
 * Logika sign/vault/validasi (Phase A–E) adalah bagian paling mahal dari
 * proyek ini; UI hanya MENYUSUN ulang modul yang sama, sehingga perilaku
 * wallet browser dijamin identik dengan node/CLI yang sudah teruji gate.
 */
// Setelah restrukturisasi, modul backend live di bawah `src/`.
// Alias ini mengarahkan import `src/<modul>/...` ke root repo agar UI
// menyusun ulang modul yang sama persis dengan node (tanpa duplikasi).
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
			// 'buffer' DIPAKSA ke paket npm: Node builtin tidak ada di browser,
			// dan bip39 (mnemonic/seed) memanggil Buffer.from. Resolusi ambigu
			// antara builtin vs paket dicegah di sini supaya bundle browser
			// selalu membawa implementasi JS murni.
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
		// File backend ada di LUAR root wallet-ui → izinkan dev server
		// menyajikannya (default Vite memblokir path di luar root).
		fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
	},
	build: {
		outDir: 'dist',
		sourcemap: false,
		// Worker entry point — dibundle terpisah dari main app
		rollupOptions: {
			input: {
				main: 'index.html',
				cryptoWorker: 'src/workers/crypto.worker.ts',
			},
		},
	},
	// Worker format ES untuk mendukung code splitting
	worker: {
		format: 'es',
	},
})
