/**
 * Diagnosa runtime popup: buka dist/popup.html di Chrome headless dengan
 * logging konsol aktif, lalu cetak semua error/console yang muncul.
 *
 * Kenapa ada: screenshot hanya menunjukkan HASIL (layar kosong), bukan SEBAB.
 * Harness `preview.html` memverifikasi markup tiruan, jadi bug di bundel React
 * yang sebenarnya tidak pernah tertangkap. Skrip ini memuat bundel asli.
 *
 * Pemakaian:
 *   bun scripts/diagnosePopup.ts
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const CHROME =
	process.env.CHROME_PATH ??
	'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.PREVIEW_PORT ?? 4180)
const PROFILE = join(tmpdir(), 'nexchain-diag-profile')

if (!existsSync(CHROME)) {
	console.error(`[diag] Chrome tidak ditemukan di ${CHROME}`)
	process.exit(1)
}

const sleep = (ms: number): Promise<void> =>
	new Promise((done) => setTimeout(done, ms))

const env = { ...process.env, NO_PROXY: '*', no_proxy: '*' }

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })

const server = spawn(
	'python',
	['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
	{ cwd: join(root, 'dist'), env, stdio: 'ignore' },
)

const url = `http://127.0.0.1:${PORT}/popup.html`

try {
	// Tunggu server.
	let up = false
	for (let i = 0; i < 30; i += 1) {
		await sleep(200)
		try {
			const res = await fetch(url)
			if (res.ok) {
				up = true
				break
			}
		} catch {
			/* belum siap */
		}
	}
	if (!up) {
		console.error(`[diag] Server tidak siap di ${url}`)
		process.exit(1)
	}

	console.log(`[diag] Memuat ${url} dengan logging konsol…`)
	const result = spawnSync(
		CHROME,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--no-proxy-server',
			`--user-data-dir=${PROFILE}`,
			'--enable-logging=stderr',
			'--v=1',
			'--virtual-time-budget=8000',
			'--dump-dom',
			url,
		],
		{ encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 },
	)

	const stdout = result.stdout ?? ''
	const stderr = result.stderr ?? ''

	// Baris konsol Chrome biasanya di stderr dengan tag "CONSOLE" / "ERROR".
	const interesting = stderr
		.split('\n')
		.filter((line) =>
			/CONSOLE|ERROR|Uncaught|Failed to load|Refused|CSP|Content Security/i.test(
				line,
			),
		)
		.slice(0, 60)

	console.log('\n=== jejak konsol (stderr) ===')
	if (interesting.length === 0) console.log('(tidak ada baris mencurigakan)')
	for (const line of interesting) console.log('  ' + line.trim())

	// Jejak boot terstruktur `[nex-boot]` — inti diagnostik.
	const boot = stderr
		.split('\n')
		.filter((line) => line.includes('[nex-boot]'))
		.map((line) => {
			const idx = line.indexOf('[nex-boot]')
			return line.slice(idx).trim()
		})
	console.log('\n=== JEJAK BOOT [nex-boot] ===')
	if (boot.length === 0) {
		console.log('  (TIDAK ADA jejak boot → bundel gagal dimuat/di-parse!)')
	} else {
		for (const line of boot) console.log('  ' + line)
	}

	// Marker ringkasan diagnostik yang ditulis ke DOM.
	const diagMatch = stdout.match(
		/<script id="boot-diag"[^>]*>([\s\S]*?)<\/script>/,
	)
	console.log('\n=== RINGKASAN DIAGNOSTIK (DOM #boot-diag) ===')
	if (!diagMatch) {
		console.log('  (marker tidak ditulis — diagnostik tidak sampai selesai)')
	} else {
		try {
			const parsed = JSON.parse(diagMatch[1]) as {
				storage: string
				worker: string
			}
			console.log(`  storage: ${parsed.storage}`)
			console.log(`  worker : ${parsed.worker}`)
		} catch {
			console.log('  ' + diagMatch[1].trim())
		}
	}

	// Apakah React benar-benar merender? Cek #root punya anak.
	const rootMatch = stdout.match(/<div id="root"[^>]*>([\s\S]*?)<\/div>\s*<script/i)
	const rootHtml = rootMatch ? rootMatch[1] : ''
	console.log('\n=== #root ===')
	console.log(`  panjang isi: ${rootHtml.length}`)
	if (rootHtml.length < 50) {
		console.log('  ISI KOSONG → React tidak ter-mount (lihat error di atas).')
	} else {
		console.log('  ada konten → React ter-mount.')
	}

	// Apakah pesan galat spesifik muncul di DOM?
	if (/Penyimpanan tidak merespons/.test(stdout)) {
		console.log(
			'\n[diag] !! PESAN "Penyimpanan tidak merespons" DITEMUKAN di DOM.',
		)
	}
	if (/Menyiapkan vault lokal/.test(stdout)) {
		console.log('\n[diag] !! Masih di splash "Menyiapkan vault lokal…".')
	}
} finally {
	server.kill()
}
