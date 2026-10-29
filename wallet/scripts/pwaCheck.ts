/**
 * Gate offline: artefak PWA dari target `web`.
 *
 * Yang dibuktikan di sini TIDAK BISA dibuktikan `tsc` atau smoke vault:
 * hasil build-nya benar-benar bisa dipasang dan bekerja offline. Semua
 * kegagalan di bawah ini punya gejala yang menyesatkan di browser (aplikasi
 * tetap "jalan", hanya ikon kosong, update tidak pernah sampai, atau
 * `/rpc` dilayani `index.html`), jadi diperiksa dari berkasnya langsung.
 *
 *   1. `index.html` berada di AKAR `dist/web` (bukan di subfolder shell) dan
 *      memuat meta yang menentukan iOS bisa memasang: `viewport-fit=cover`,
 *      `apple-mobile-web-app-capable`, `apple-touch-icon`, `theme-color`.
 *   2. `manifest.webmanifest` valid dan ikonnya BENAR-BENAR berukuran sesuai
 *      yang diklaim (dibaca dari header PNG, bukan dari nama berkas).
 *   3. `sw.js` ada, memuat SELURUH berkas build di precache, dan tidak
 *      memuat satu pun URL `/rpc` — RPC bukan rute SPA dan tidak boleh
 *      pernah dilayani cache.
 *   4. `navigateFallback` + denylist `/rpc` ikut tertulis di `sw.js`.
 *
 * Build dijalankan di dalam gate (bukan diasumsikan sudah ada) supaya hasil
 * yang diperiksa selalu berasal dari sumber saat ini. `tsc` sengaja tidak
 * dijalankan lagi — sudah jadi gate pertama di fase offline.
 *
 * Jalankan: bun scripts/pwaCheck.ts   (dari `wallet/`)
 *           bun run wallet:smoke:pwa (dari root repo)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WALLET_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST_DIR = join(WALLET_DIR, 'dist', 'web')
const VITE_BIN = join(WALLET_DIR, 'node_modules', 'vite', 'bin', 'vite.js')

let passed = 0
let failed = 0

const ok = (condition: boolean, label: string, detail?: string): void => {
	if (condition) {
		passed += 1
		console.log(`OK   ${label}`)
		return
	}
	failed += 1
	console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const build = (): void => {
	console.log('— build target web —')
	const result = spawnSync(
		process.execPath,
		[VITE_BIN, 'build', '--mode', 'web'],
		{ cwd: WALLET_DIR, stdio: 'inherit', env: process.env },
	)
	if (result.status !== 0) {
		console.error('Build `vite build --mode web` gagal — gate dihentikan.')
		process.exit(1)
	}
}

// ---------------------------------------------------------------------------
// Utilitas berkas
// ---------------------------------------------------------------------------

/** Semua berkas di bawah `dir`, path relatif bergaya POSIX (mis. `assets/a.js`). */
const walk = (dir: string, prefix = ''): string[] => {
	const entries = readdirSync(dir, { withFileTypes: true })
	const files: string[] = []
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) files.push(...walk(join(dir, entry.name), rel))
		else files.push(rel)
	}
	return files.sort()
}

const readText = (rel: string): string =>
	readFileSync(join(DIST_DIR, rel), 'utf8')

interface PngSize {
	width: number
	height: number
}

/**
 * Dimensi PNG dari header IHDR.
 *
 * Memeriksa angka sebenarnya, bukan nama berkas: ikon 512 yang isinya 192
 * tetap akan ditolak Android saat pemasangan, dan kegagalannya tidak terlihat
 * di desktop.
 */
const pngSize = (rel: string): PngSize | undefined => {
	const buf = readFileSync(join(DIST_DIR, rel))
	if (buf.length < 24) return undefined
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
	const matches = signature.every((byte, index) => buf[index] === byte)
	if (!matches) return undefined
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

interface ManifestIcon {
	src?: string
	sizes?: string
	type?: string
	purpose?: string
}

interface Manifest {
	name?: string
	short_name?: string
	id?: string
	start_url?: string
	scope?: string
	display?: string
	theme_color?: string
	background_color?: string
	icons?: ManifestIcon[]
}

// ---------------------------------------------------------------------------
// Pemeriksaan
// ---------------------------------------------------------------------------

const main = (): void => {
	build()

	// ── 1. Struktur hasil build ─────────────────────────────────────────────
	ok(existsSync(DIST_DIR), 'dist/web ada')
	if (!existsSync(DIST_DIR)) {
		console.log(`\n${passed} OK / ${failed} FAIL`)
		process.exit(1)
	}

	const files = walk(DIST_DIR)
	ok(files.includes('index.html'), 'index.html di AKAR dist/web')
	ok(
		!files.some((file) => file.startsWith('shells/')),
		'tidak ada sisa path shell di dist/web',
		files.find((file) => file.startsWith('shells/')),
	)
	ok(files.includes('sw.js'), 'sw.js dihasilkan')
	ok(files.includes('manifest.webmanifest'), 'manifest.webmanifest dihasilkan')
	ok(
		files.some((file) => file.startsWith('assets/') && file.endsWith('.js')),
		'bundle JS ada di assets/',
	)
	ok(
		files.some((file) => /cryptoWorker/i.test(file)),
		'worker crypto ikut dibundel',
	)

	// ── 2. index.html: meta yang menentukan pemasangan ─────────────────────
	const html = readText('index.html')
	ok(/id="root"/.test(html), 'index.html punya #root')
	ok(/viewport-fit=cover/.test(html), 'viewport-fit=cover (safe-area iOS)')
	ok(
		/<link[^>]+rel="manifest"/.test(html),
		'<link rel="manifest"> disuntikkan vite-plugin-pwa',
	)
	ok(
		/apple-mobile-web-app-capable"\s+content="yes"/.test(html),
		'meta iOS capable',
	)
	ok(
		/apple-touch-icon-180x180\.png/.test(html),
		'apple-touch-icon 180 ditautkan',
	)
	ok(/name="theme-color"[^>]*#2f6fab/i.test(html), 'theme-color #2f6fab')
	ok(
		/Content-Security-Policy/.test(html) &&
			/worker-src 'self' blob:/.test(html),
		'CSP mengizinkan worker crypto',
	)
	ok(
		!/src="\/shells\//.test(html) && !/src="\.\/shells\//.test(html),
		'script tidak menunjuk path shells/',
	)

	// ── 3. Manifest ────────────────────────────────────────────────────────
	let manifest: Manifest | undefined
	try {
		manifest = JSON.parse(readText('manifest.webmanifest')) as Manifest
	} catch (error) {
		ok(false, 'manifest.webmanifest valid JSON', String(error))
	}
	if (manifest) {
		ok(manifest.name === 'NexChain Wallet', 'manifest.name')
		ok(manifest.short_name === 'NexChain', 'manifest.short_name')
		ok(manifest.id === '/', 'manifest.id = /')
		ok(manifest.start_url === '/', 'manifest.start_url = /')
		ok(manifest.scope === '/', 'manifest.scope = /')
		ok(
			manifest.display === 'standalone',
			'manifest.display = standalone',
			manifest.display,
		)
		ok(manifest.theme_color === '#2f6fab', 'manifest.theme_color')
		ok(manifest.background_color === '#f5f7fa', 'manifest.background_color')

		const icons = manifest.icons ?? []
		const have = (size: string, purpose: string): ManifestIcon | undefined =>
			icons.find(
				(icon) =>
					icon.sizes === size &&
					(icon.purpose ?? 'any').split(' ').includes(purpose),
			)

		for (const [size, purpose] of [
			['192x192', 'any'],
			['512x512', 'any'],
			['512x512', 'maskable'],
		] as const) {
			const icon = have(size, purpose)
			ok(Boolean(icon), `manifest ikon ${size} (${purpose})`)
			if (!icon?.src) continue
			const rel = icon.src.replace(/^\.?\//, '')
			ok(existsSync(join(DIST_DIR, rel)), `ikon ${rel} ada`, icon.src)
			const dims = existsSync(join(DIST_DIR, rel)) ? pngSize(rel) : undefined
			const [w, h] = size.split('x').map(Number)
			ok(
				dims?.width === w && dims?.height === h,
				`ikon ${rel} benar ${size}`,
				dims ? `${dims.width}x${dims.height}` : 'bukan PNG',
			)
		}
	}

	const appleRel = 'apple-touch-icon-180x180.png'
	if (existsSync(join(DIST_DIR, appleRel))) {
		const dims = pngSize(appleRel)
		ok(
			dims?.width === 180 && dims?.height === 180,
			'apple-touch-icon benar 180×180',
			dims ? `${dims.width}x${dims.height}` : 'bukan PNG',
		)
	} else {
		ok(false, 'apple-touch-icon-180x180.png ada')
	}

	// ── 4. Service worker ──────────────────────────────────────────────────
	if (!files.includes('sw.js')) {
		console.log(`\n${passed} OK / ${failed} FAIL`)
		process.exit(1)
	}

	const sw = readText('sw.js')
	ok(sw.includes('index.html'), 'sw.js memakai navigateFallback index.html')
	ok(/rpc/i.test(sw), 'denylist /rpc tertulis di sw.js')
	ok(!/skipWaiting\s*:\s*true/.test(sw), 'sw.js tidak skipWaiting paksa')
	ok(
		!/autoUpdate|__SW_AUTO_UPDATE__/.test(sw),
		'sw.js tidak dalam mode autoUpdate',
	)

	const precache = [...sw.matchAll(/url\s*:\s*"([^"]+)"/g)]
		.map((match) => match[1])
		.sort()
	ok(precache.length > 0, 'precache manifest tidak kosong')
	ok(
		precache.every((url) => !/^\.?\/?rpc(\/|$)/.test(url)),
		'tidak ada URL /rpc di precache',
		precache.find((url) => /rpc/i.test(url)),
	)

	const precacheSet = new Set(precache.map((url) => url.replace(/^\.?\//, '')))
	const missingFromCache = precache.filter((url) => {
		const rel = url.replace(/^\.?\//, '')
		return !existsSync(join(DIST_DIR, rel))
	})
	ok(
		missingFromCache.length === 0,
		'semua entri precache menunjuk berkas yang ada',
		missingFromCache.join(', '),
	)

	/**
	 * `sw.js` sendiri dan runtime Workbox (`workbox-*.js`) memang TIDAK boleh
	 * di-precache — keduanya dimuat lewat `importScripts`/registrasi, dan
	 * mem-precache `sw.js` akan membuat SW lama menyajikan dirinya sendiri.
	 */
	const notPrecached = files.filter(
		(file) =>
			!precacheSet.has(file) &&
			file !== 'sw.js' &&
			!/^workbox-[^/]+\.js$/.test(file) &&
			!file.endsWith('.map'),
	)
	ok(
		notPrecached.length === 0,
		'semua berkas build masuk precache',
		notPrecached.join(', '),
	)

	console.log(`\n${passed} OK / ${failed} FAIL`)
	if (failed > 0) process.exit(1)
	console.log('Artefak PWA siap dipasang.')
}

main()
