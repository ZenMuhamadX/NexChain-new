import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
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
		 *   - URL RPC     : default node publik, bisa diganti di Settings
		 *                   atau dipaksa lewat `VITE_RPC_URL`. Lihat
		 *                   `src/lib/rpcUrl.ts`.
		 *   - Explorer    : default explorer publik (`src/lib/explorerUrl.ts`).
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
		plugins: isWeb
			? [createPwaPlugin()]
			: target === 'dev'
				? [devShellGuard()]
				: [],
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
		 * Port preview WAJIB 5174 — sama dengan dev server, karena keduanya
		 * tidak pernah berjalan bersamaan. Default `vite preview` (4173) juga
		 * akan bekerja (node publik membalas CORS sesuai origin), tapi
		 * menyamakan port membuat uji PWA tidak perlu mengingat dua alamat.
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
/**
 * Jaring pengaman shell developer — HANYA untuk target `dev`.
 *
 * Dua masalah nyata yang sumbernya satu: `vite preview --mode web` memakai
 * PORT YANG SAMA (5174) dengan dev server, jadi keduanya berbagi satu origin.
 *
 *   1. SERVICE WORKER TERTINGGAL. SW PWA yang pernah terdaftar di origin itu
 *      tidak hilang saat dev server dijalankan. Ia tetap melayani `/index.html`
 *      dari cache produksi, sehingga `bun dev` menampilkan UI LAMA, dan
 *      navigasi apa pun yang tidak ada di precache jatuh ke fallback yang juga
 *      tidak ada di dev server → "not found".
 *
 *      Solusinya bukan menyuruh orang membersihkan DevTools tiap kali:
 *      dev server menyajikan `/sw.js` versi BUNUH DIRI. Browser memeriksa
 *      ulang berkas itu pada setiap navigasi, jadi SW produksi yang tertinggal
 *      akan menggantikan dirinya dengan versi ini, menghapus cache, melepas
 *      registrasinya, lalu memuat ulang tab. Sekali, lalu bersih selamanya.
 *
 *   2. ROOT 404. Root Vite adalah `wallet/`, dan di situ tidak ada
 *      `index.html` — entri dev shell ada di `shells/dev/`. Membuka
 *      `localhost:5174` langsung karena itu selalu 404. Middleware ini
 *      mengalihkannya ke `/shells/dev/`.
 */
const KILL_SW = `// Dihasilkan dev server NexChain: matikan service worker sisa build PWA.
self.addEventListener('install', () => {
	self.skipWaiting()
})

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			try {
				const keys = await caches.keys()
				await Promise.all(keys.map((key) => caches.delete(key)))
				await self.registration.unregister()
				const windows = await self.clients.matchAll({ type: 'window' })
				for (const client of windows) {
					// Tab yang masih dikendalikan SW ini akan memuat ulang ke
					// dev server tanpa SW. Gagal di satu tab tidak boleh
					// menghentikan pembersihan tab lain.
					client.navigate(client.url).catch(() => {})
				}
			} catch {
				// Biarkan; registrasi tetap dilepas oleh unregister() di atas
				// bila hanya penghapusan cache yang gagal.
			}
		})(),
	)
})
`

const devShellGuard = (): Plugin => ({
	name: 'nex-dev-shell-guard',
	apply: 'serve',
	configureServer(server) {
		server.middlewares.use((request, response, next) => {
			const path = (request.url ?? '').split('?')[0]

			if (path === '/sw.js') {
				response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
				response.setHeader('Cache-Control', 'no-store')
				response.end(KILL_SW)
				return
			}

			if (path === '/' || path === '') {
				response.statusCode = 302
				response.setHeader('Location', '/shells/dev/')
				response.end()
				return
			}

			next()
		})
	},
})

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
