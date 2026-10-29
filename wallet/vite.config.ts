import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

const stripSlash = (value: string): string =>
	value.replace(/\\/g, '/').replace(/\/+$/, '')

const repoRoot = stripSlash(fileURLToPath(new URL('..', import.meta.url)))
const walletRoot = stripSlash(fileURLToPath(new URL('.', import.meta.url)))
const webRoot = `${walletRoot}/shells/web`

/** Versi wallet, di-bake sebagai `__APP_VERSION__` (ditampilkan di Settings). */
const walletVersion =
	(
		JSON.parse(readFileSync(`${walletRoot}/package.json`, 'utf8')) as {
			version?: string
		}
	).version ?? '0.0.0'

/**
 * TIGA target build dari SATU konfigurasi.
 *
 *   VITE_TARGET=dev      → shell developer (vault memori, port 5174)
 *   VITE_TARGET=desktop  → shell desktop (vault berkas, diisi Electron/Tauri)
 *   VITE_TARGET=web      → PWA yang dipasang di HP (vault IndexedDB)
 *
 * Semua target memakai `src/` yang SAMA (sembilan layar, logika vault). Yang
 * berbeda hanya entry HTML dan backend yang disuntikkan shell.
 *
 * Catatan: target `ext` sudah dipensiunkan — ekstensi Chrome tidak lagi
 * didukung. Lihat catatan di AGENTS.md.
 */
type Target = 'dev' | 'desktop' | 'web'

const TARGET_ENTRY: Record<Exclude<Target, 'web'>, string> = {
	dev: 'shells/dev/index.html',
	desktop: 'shells/desktop/index.html',
}

const resolveTarget = (mode: string): Target => {
	const raw = process.env.VITE_TARGET ?? mode
	if (raw === 'web') return 'web'
	if (raw === 'desktop') return 'desktop'
	return 'dev'
}

export default defineConfig(({ mode }) => {
	const target = resolveTarget(mode)
	/**
	 * Target `web` memakai `shells/web/` sebagai Vite ROOT (bukan `wallet/`).
	 *
	 * Alasannya bukan selera: `vite-plugin-pwa` menurunkan `navigateFallback`
	 * dan daftar precache dari root build. Dengan root di `shells/web`, hasil
	 * build langsung berisi `index.html`, `sw.js`, dan `manifest.webmanifest`
	 * di AKAR `dist/web` — persis yang dibutuhkan PWA. Kalau HTML-nya tetap di
	 * `dist/web/shells/web/index.html`, SW akan jatuh ke fallback navigation
	 * yang salah dan scope bisa meleset tanpa error yang jelas.
	 */
	const isWeb = target === 'web'

	return {
		root: isWeb ? webRoot : walletRoot,
		/**
		 * `.env` OPSIONAL — dan idealnya tidak ada sama sekali.
		 *
		 * Semua nilai punya default yang benar untuk pemakaian normal:
		 *   - URL RPC     : shell yang menentukan (desktop lewat bridge,
		 *                   dev lewat localhost:8000). Lihat `src/lib/rpcUrl.ts`.
		 *   - Explorer    : kosong = link eksternal dimatikan.
		 *   - Backend vault: desktop menyuntik backend berkas sendiri; dev
		 *                   memakai memori; PWA memakai IndexedDB.
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
		envDir: walletRoot,
		/**
		 * Target `desktop` dijalankan Electron lewat `file://`, jadi URL aset
		 * HARUS relatif. Default Vite (`/assets/…`) menunjuk ke akar drive
		 * (`file:///C:/assets/…`) dan membuat renderer memuat halaman kosong —
		 * #root tetap kosong tanpa error yang jelas. `base: './'` menulis
		 * `./assets/…` sehingga berkas benar-benar ditemukan.
		 *
		 * PWA selalu disajikan di AKAR satu origin, jadi `base: '/'`.
		 */
		base: target === 'desktop' ? './' : '/',
		/**
		 * Aset statis hanya dimiliki shell web (`shells/web/public`). Shell dev
		 * dan desktop tidak punya public dir — `false` mencegah Vite diam-diam
		 * menyajikan `wallet/public` yang tidak pernah ada.
		 */
		publicDir: isWeb ? `${webRoot}/public` : false,
		define: {
			// Dipakai kartu "Aplikasi" di Settings untuk menampilkan versi build.
			__APP_VERSION__: JSON.stringify(walletVersion),
		},
		plugins: isWeb ? [createPwaPlugin()] : [],
		resolve: {
			alias: [
				// 'buffer' DIPAKSA ke paket npm: Node builtin tidak ada di browser,
				// dan bip39 (mnemonic/seed) memanggil Buffer.from. Resolusi ambigu
				// antara builtin vs paket dicegah di sini supaya bundle selalu
				// membawa implementasi JS murni.
				{
					find: /^buffer$/,
					replacement: `${walletRoot}/node_modules/buffer/index.js`,
				},
				// @ alias untuk src/ directory
				{
					find: /^@\//,
					replacement: `${walletRoot}/src/`,
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
		/**
		 * Port preview WAJIB 5174.
		 *
		 * `defaultRpcUrl()` menurunkan `http://localhost:8000/rpc` untuk halaman
		 * http di loopback, dan allowlist CORS node hanya memuat `:5173`/`:5174`.
		 * Port default `vite preview` (4173) akan diblokir browser. Dev shell dan
		 * preview tidak pernah dijalankan bersamaan, jadi port boleh sama.
		 */
		preview: isWeb ? { port: 5174 } : undefined,
		build: {
			// Absolut untuk web (root-nya bukan `wallet/`), relatif untuk sisanya.
			outDir: isWeb ? `${walletRoot}/dist/web` : `dist/${target}`,
			emptyOutDir: true,
			sourcemap: false,
			// Worker ikut dibundel; entri utama ditentukan target.
			rollupOptions: {
				input: {
					main: isWeb ? `${webRoot}/index.html` : TARGET_ENTRY[target],
					cryptoWorker: `${walletRoot}/src/workers/crypto.worker.ts`,
				},
			},
		},
		// Worker format ES untuk mendukung code splitting
		worker: {
			format: 'es',
		},
	}
})

/**
 * PWA — hanya untuk target `web`.
 *
 * Keputusan yang MAHAL kalau salah, jadi ditulis eksplisit:
 *
 *   - `registerType: 'prompt'` (bukan `autoUpdate`). `autoUpdate` memaksa
 *     `skipWaiting` + `clientsClaim` sehingga tab memuat ulang SENDIRI saat
 *     deploy. Untuk wallet itu berarti reload di tengah transaksi. Dengan
 *     `prompt`, SW baru menunggu sampai user menekan tombol di banner.
 *   - `injectRegister: null` — pendaftaran SW dilakukan `src/pwa/register.ts`,
 *     supaya status update bisa masuk ke store platform (dan banner bisa
 *     dirender React). Tidak ada tag `<script>` tambahan dari plugin.
 *   - `navigateFallbackDenylist: [/^\/rpc/]` — pagar eksplisit bahwa navigasi
 *     ke `/rpc` TIDAK PERNAH dilayani `index.html`. RPC bukan rute SPA.
 *   - `runtimeCaching: []` — tidak ada data jaringan yang di-cache. Saldo dan
 *     riwayat harus selalu datang dari node; cache HTTP untuk data keuangan
 *     adalah sumber bug "saldo tidak berubah".
 *   - `devOptions.enabled: false` — dev server TIDAK mendaftarkan SW. Di dev,
 *     `virtual:pwa-register` di-resolve plugin menjadi no-op, jadi mengimpor
 *     modul itu aman. SW diuji lewat `vite preview`.
 */
const createPwaPlugin = () =>
	VitePWA({
		registerType: 'prompt',
		injectRegister: null,
		strategies: 'generateSW',
		/**
		 * Ikon manifest TIDAK perlu ditambahkan terpisah: `globPatterns` sudah
		 * mem-precache semua `.png` di `public/`. Default `true` membuat ikon
		 * masuk dua kali (sekali tanpa revisi dari glob, sekali dengan hash),
		 * dan Workbox mengeluh soal entri duplikat di console.
		 */
		includeManifestIcons: false,
		manifest: {
			id: '/',
			name: 'NexChain Wallet',
			short_name: 'NexChain',
			description:
				'Wallet NexChain dengan vault terenkripsi yang tersimpan di perangkat Anda.',
			lang: 'id',
			dir: 'ltr',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			// Selaras dengan `--bg` dan `--primary` di `src/style.css`.
			background_color: '#f5f7fa',
			theme_color: '#2f6fab',
			categories: ['finance'],
			icons: [
				{
					src: '/pwa-192x192.png',
					sizes: '192x192',
					type: 'image/png',
					purpose: 'any',
				},
				{
					src: '/pwa-512x512.png',
					sizes: '512x512',
					type: 'image/png',
					purpose: 'any',
				},
				{
					src: '/maskable-icon-512x512.png',
					sizes: '512x512',
					type: 'image/png',
					purpose: 'maskable',
				},
			],
		},
		workbox: {
			globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
			navigateFallback: '/index.html',
			navigateFallbackDenylist: [/^\/rpc/],
			cleanupOutdatedCaches: true,
			runtimeCaching: [],
			// Eksplisit: jangan pernah mengambil alih halaman tanpa izin user.
			skipWaiting: false,
			clientsClaim: false,
		},
		devOptions: { enabled: false },
	})
