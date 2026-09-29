import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'

/**
 * Buang atribut `crossorigin` dari tag yang dihasilkan Vite.
 *
 * Kenapa perlu: Vite menambahkan `crossorigin` pada `<script type="module">`
 * dan `<link rel="stylesheet">`. Di halaman biasa itu benar (module selalu
 * CORS). Tetapi di halaman extension `chrome-extension://`, permintaan
 * same-origin TIDAK mengirim header CORS, sedangkan mode CORS yang dipicu
 * `crossorigin` tetap menuntutnya — akibatnya skrip/modul bisa DITOLAK dan
 * halaman tampil kosong tanpa error yang jelas. Ini jebakan MV3 yang umum.
 */
const stripCrossorigin = (): Plugin => ({
	name: 'nex-strip-crossorigin',
	enforce: 'post',
	transformIndexHtml: {
		order: 'post',
		handler: (html) =>
			html
				.replace(/\s+crossorigin(?:="[^"]*")?/g, '')
				// Vite memakai tipe `module` (default) untuk script modul;
				// pastikan tetap ada meski tanpa crossorigin.
				.replace(
					/<script type="module"/g,
					'<script type="module"',
				),
	},
})

/**
 * Vite config untuk NexChain Wallet Extension (MV3).
 *
 * PERBEDAAN KUNCI dari wallet-ui:
 *   wallet-ui  → alias ROOT_MODULES menunjuk ke `../` (root repo NexChain).
 *   wallet-ext → alias menunjuk ke `./src/vendor/` (SNAPSHOT di dalam repo ini).
 *
 * Dengan begitu extension ini MANDIRI: tidak ada satu pun import yang keluar
 * dari folder wallet-ext. Snapshot di `src/vendor/` diisi oleh
 * `scripts/snapshotVendor.ts` dari repo NexChain.
 */
const VENDOR_MODULES = [
	'account',
	'base',
	'client',
	'common',
	'interface',
	'key',
	'logging',
	'nexchain',
	'rpc',
	'scripts',
	'sign',
	'wallet',
] as const

export default defineConfig({
	// WAJIB untuk MV3: path ASET harus relatif (`./chunks/...`), bukan
	// absolut (`/chunks/...`). Di halaman extension, URL absolut di-resolve
	// terhadap AKAR PAKET extension, sehingga `new URL("/assets/x.js",
	// import.meta.url)` dan seluruh rujukan aset rapuh terhadap lokasi file.
	// Relatif membuat popup.html, wallet.html, dan worker semuanya konsisten.
	base: './',
	plugins: [stripCrossorigin()],
	resolve: {
		alias: [
			{
				find: /^buffer$/,
				replacement: fileURLToPath(
					new URL('./node_modules/buffer/index.js', import.meta.url),
				),
			},
			{
				find: /^@\//,
				replacement: fileURLToPath(new URL('./src/', import.meta.url)),
			},
			...VENDOR_MODULES.map((m) => ({
				find: new RegExp(`^${m}/`),
				replacement: fileURLToPath(new URL(`./src/vendor/${m}/`, import.meta.url)),
			})),
		],
	},
	esbuild: { jsx: 'automatic' },
	server: {
		port: 5175,
	},
	build: {
		outDir: 'dist',
		sourcemap: false,
		// Chrome memuat file dari dist/ apa adanya; chunk kecil tidak membantu
		// (popup sudah dipanggil lokal). Batas naik agar tidak ada peringatan
		// chunk besar dari bundel crypto.
		chunkSizeWarningLimit: 1500,
		// Output MV3: popup + tab + service worker + content/inpage, dibundle terpisah.
		rollupOptions: {
			input: {
				popup: resolve(__dirname, 'popup.html'),
				wallet: resolve(__dirname, 'wallet.html'),
				// Halaman diagnostik SEMENTARA — buka via
				// chrome-extension://<ID>/diagnostics.html
				diagnostics: resolve(__dirname, 'diagnostics.html'),
				background: resolve(__dirname, 'src/background/service-worker.ts'),
				content: resolve(__dirname, 'src/content/content.ts'),
				inpage: resolve(__dirname, 'src/inpage/inpage.ts'),
			},
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: 'chunks/[name].js',
				assetFileNames: 'assets/[name][extname]',
			},
		},
	},
	worker: {
		format: 'es',
	},
})
