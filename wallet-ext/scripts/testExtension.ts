/**
 * Uji artefak extension yang SUDAH DIBANGUN di Chrome asli.
 *
 * Kenapa ada: `preview.html` menguji markup TIRUAN, jadi bug yang hanya muncul
 * di origin `chrome-extension://` (path aset, CSP, worker) lolos. Skrip ini
 * memuat `dist/` sebagai unpacked extension dan memotret popup sebenarnya.
 *
 * ID extension dipaku lewat `key` di manifest (lihat scripts/makeExtKey.py),
 * sehingga URL popup bisa diprediksi tanpa menanyakan Chrome.
 *
 * Pemakaian:
 *   bun scripts/testExtension.ts
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const distDir = join(root, 'dist')
const outDir = join(root, '.preview-shots')

const CHROME =
	process.env.CHROME_PATH ??
	'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = join(tmpdir(), 'nexchain-ext-test')
const SCALE = 2

if (!existsSync(CHROME)) {
	console.error(`[ext] Chrome tidak ditemukan di ${CHROME}`)
	process.exit(1)
}

const manifestPath = join(distDir, 'manifest.json')
if (!existsSync(manifestPath)) {
	console.error('[ext] dist/manifest.json tidak ada — jalankan `bun run build`.')
	process.exit(1)
}

// Hitung ID dari `key` manifest (SHA256 SPKI → 32 heks → peta a-p).
const computeId = (b64key: string): string => {
	const der = Buffer.from(b64key, 'base64')
	const hex = createHash('sha256').update(der).digest('hex').slice(0, 32)
	const map = 'abcdefghijklmnop'
	let id = ''
	for (const ch of hex) id += map[parseInt(ch, 16)]
	return id
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
	key?: string
}

const env = {
	...process.env,
	NO_PROXY: '*',
	no_proxy: '*',
	HTTP_PROXY: '',
	HTTPS_PROXY: '',
	http_proxy: '',
	https_proxy: '',
}

mkdirSync(outDir, { recursive: true })
rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })

// Tanpa `key`, Chrome menurunkan ID dari path — kita masih bisa membacanya
// dari target service worker, tapi dengan `key` URL-nya pasti.
const extId = manifest.key ? computeId(manifest.key) : ''
if (extId) console.log(`[ext] ID dari manifest.key: ${extId}`)

const popupUrl = extId
	? `chrome-extension://${extId}/popup.html`
	: 'about:blank'

const shots = [
	{ name: 'ext-popup', url: `${popupUrl}`, w: 360, h: 600 },
	...(extId
		? [{ name: 'ext-wallet-tab', url: `chrome-extension://${extId}/wallet.html`, w: 1000, h: 800 }]
		: []),
]

for (const shot of shots) {
	const out = join(outDir, `${shot.name}.png`)
	const result = spawnSync(
		CHROME,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--no-proxy-server',
			`--user-data-dir=${PROFILE}-${shot.name}`,
			`--disable-extensions-except=${distDir}`,
			`--load-extension=${distDir}`,
			`--window-size=${shot.w},${shot.h}`,
			`--force-device-scale-factor=${SCALE}`,
			'--virtual-time-budget=8000',
			`--screenshot=${out}`,
			shot.url,
		],
		{ encoding: 'utf8', env },
	)

	if (existsSync(out)) {
		console.log(`[ext] ${shot.name}: OK (${shot.url})`)
	} else {
		console.error(`[ext] ${shot.name}: GAGAL`)
		console.error(result.stderr?.slice(-500) ?? '(tidak ada stderr)')
	}
}
