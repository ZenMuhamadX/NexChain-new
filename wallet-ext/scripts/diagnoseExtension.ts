/**
 * Jalankan `diagnostics.html` DI DALAM extension sungguhan (unpacked) dan
 * cetak hasilnya.
 *
 * KENAPA INI PENTING
 *   `diagnosePopup.ts` memuat `dist/popup.html` lewat HTTP biasa. Di sana
 *   `chrome.*` tidak ada, jadi semua pemeriksaan storage jatuh ke fallback
 *   localStorage dan SELALU tampak sehat — bug yang hanya muncul di origin
 *   `chrome-extension://` tidak pernah terlihat.
 *
 *   Skrip ini memuat `dist/` sebagai unpacked extension, membuka
 *   `chrome-extension://<ID>/diagnostics.html`, dan membaca marker
 *   `<script id="diag-result">` dari DOM.
 *
 * Pemakaian:
 *   bun scripts/diagnoseExtension.ts
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const distDir = join(root, 'dist')

const CHROME =
	process.env.CHROME_PATH ??
	'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = join(tmpdir(), 'nexchain-diag-ext')

if (!existsSync(CHROME)) {
	console.error(`[diag-ext] Chrome tidak ditemukan di ${CHROME}`)
	process.exit(1)
}

const manifestPath = join(distDir, 'manifest.json')
if (!existsSync(manifestPath)) {
	console.error('[diag-ext] dist/manifest.json tidak ada — jalankan `bun run build`.')
	process.exit(1)
}

/** ID extension = SHA256(SPKI) → 32 heks → peta a-p (sama seperti testExtension). */
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

if (!manifest.key) {
	console.error('[diag-ext] manifest tidak punya `key` — ID tidak bisa diprediksi.')
	process.exit(1)
}

const extId = computeId(manifest.key)
const url = `chrome-extension://${extId}/diagnostics.html`

const env = {
	...process.env,
	NO_PROXY: '*',
	no_proxy: '*',
	HTTP_PROXY: '',
	HTTPS_PROXY: '',
	http_proxy: '',
	https_proxy: '',
}

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })

console.log(`[diag-ext] ID extension: ${extId}`)
console.log(`[diag-ext] Membuka ${url}`)

const result = spawnSync(
	CHROME,
	[
		'--headless=new',
		'--disable-gpu',
		'--no-sandbox',
		'--no-proxy-server',
		`--user-data-dir=${PROFILE}`,
		`--disable-extensions-except=${distDir}`,
		`--load-extension=${distDir}`,
		'--enable-logging=stderr',
		'--v=1',
		'--virtual-time-budget=30000',
		'--dump-dom',
		url,
	],
	{ encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 },
)

const stdout = result.stdout ?? ''
const stderr = result.stderr ?? ''

// 1. Baris konsol dari halaman extension.
const consoleLines = stderr
	.split('\n')
	.filter((line) => /CONSOLE|Uncaught|Refused|CSP|Content Security/i.test(line))
	.map((line) => {
		const m = line.match(/CONSOLE:\d+\]\s*"(.*)",\s*source:/)
		return m ? m[1] : line.trim()
	})
	.slice(0, 80)

console.log('\n=== KONSOL HALAMAN EXTENSION ===')
if (consoleLines.length === 0) {
	console.log('  (tidak ada)')
} else {
	for (const line of consoleLines) console.log('  ' + line)
}

// 2. Marker hasil diagnostik.
const marker = stdout.match(/<script id="diag-result"[^>]*>([\s\S]*?)<\/script>/)
console.log('\n=== HASIL DIAGNOSTIK ===')
if (!marker) {
	console.log('  (marker #diag-result tidak ditemukan — skrip tidak sampai render)')
	const bodyText = stdout
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
	console.log('  teks halaman: ' + bodyText.slice(0, 900))
} else {
	try {
		const parsed = JSON.parse(marker[1]) as {
			env: Array<[string, string]>
			results: Array<{ label: string; status: string; detail: string }>
		}
		console.log('\n  -- Lingkungan --')
		for (const [k, v] of parsed.env) console.log(`  ${k}: ${v}`)
		console.log('\n  -- Uji --')
		for (const r of parsed.results) {
			const mark =
				r.status === 'ok' ? 'OK   ' : r.status === 'bad' ? 'GAGAL' : 'WARN '
			console.log(`  [${mark}] ${r.label} — ${r.detail}`)
		}
		const bad = parsed.results.filter((r) => r.status === 'bad')
		console.log('\n  KESIMPULAN: ' + (
			bad.length === 0
				? 'semua lapisan responsif.'
				: `${bad.length} GAGAL → ${bad.map((b) => b.label).join(', ')}`
		))
	} catch (error) {
		console.log('  gagal parse marker: ' + String(error))
		console.log('  raw: ' + marker[1].slice(0, 600))
	}
}
