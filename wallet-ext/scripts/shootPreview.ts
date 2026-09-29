/**
 * Tangkap screenshot setiap layar preview pada ukuran popup asli (360x600).
 *
 * Kenapa ada: `tsc` hanya membuktikan tipe benar. Ia TIDAK bisa memberi tahu
 * bahwa sesuatu meluber keluar kotak 360x600, terpotong, atau bertumpuk.
 * Skrip ini merender markup nyata pada lebar popup dan menyimpan hasilnya
 * supaya tata letak bisa diperiksa mata sebelum di-load ke Chrome.
 *
 * Skrip ini SENGAJA menjalankan server statis-nya sendiri lalu mematikannya
 * lagi di akhir. Alasannya: di lingkungan ini proses latar tidak bertahan
 * antar-perintah, jadi `python -m http.server` yang dijalankan manual sudah
 * mati sebelum Chrome sempat membuka halaman (ERR_CONNECTION_REFUSED).
 *
 * Pemakaian:
 *   bun scripts/shootPreview.ts
 *
 * Variabel opsional:
 *   CHROME_PATH  lokasi chrome.exe (default: instalasi standar Windows)
 *   PREVIEW_PORT porta server sementara (default 4173)
 *   SHOT_SCALE   faktor perbesaran (default 2)
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outDir = join(root, '.preview-shots')

// Chrome menolak menulis screenshot diam-diam kalau profil default sedang
// dipakai jendela Chrome yang terbuka. Profil terpisah sekali-pakai membuat
// penangkapan selalu jalan, bahkan saat pengguna sedang browsing.
const profileDir = join(tmpdir(), 'nexchain-preview-profile')

const CHROME =
	process.env.CHROME_PATH ??
	'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.PREVIEW_PORT ?? 4173)
const BASE = `http://127.0.0.1:${PORT}/preview.html`
const SCALE = Number(process.env.SHOT_SCALE ?? 2)
const PYTHON = process.env.PYTHON_BIN ?? 'python'

const POPUP_W = 360
const POPUP_H = 600
/** Lebar kolom bila harness melipat 3 kotak sebaris (kotak 360 + gap 20). */
const COL_STRIDE = 380
const COLS = 3

if (!existsSync(CHROME)) {
	console.error(`[shots] Chrome tidak ditemukan di ${CHROME}`)
	console.error('        Set CHROME_PATH ke lokasi chrome.exe Anda.')
	process.exit(1)
}

const sleep = (ms: number): Promise<void> =>
	new Promise((done) => setTimeout(done, ms))

const reachable = async (): Promise<boolean> => {
	try {
		const res = await fetch(BASE, { redirect: 'manual' })
		return res.ok || res.status === 304
	} catch {
		return false
	}
}

/** Kotak satu layar seperti dilaporkan preview.html (satuan px CSS). */
export interface ShotBox {
	name: string
	x: number
	y: number
	w: number
	h: number
}

/**
 * Baca blok `<script id="shot-geometry">` dari DOM yang di-dump Chrome.
 * Harness menulisnya dari getBoundingClientRect(), jadi nilainya mengikuti
 * tata letak nyata — bukan tinggi baris yang ditebak di sini.
 */
export const parseGeometry = (html: string): ShotBox[] | null => {
	const match = html.match(
		/<script[^>]*id="shot-geometry"[^>]*>([\s\S]*?)<\/script>/,
	)
	if (!match) return null
	try {
		const parsed = JSON.parse(match[1])
		if (!Array.isArray(parsed) || parsed.length === 0) return null
		return parsed as ShotBox[]
	} catch {
		return null
	}
}

// Proxy lingkungan membuat semua permintaan localhost dibelokkan; matikan.
const env = { ...process.env, NO_PROXY: '*', no_proxy: '*' }

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
rmSync(profileDir, { recursive: true, force: true })
mkdirSync(profileDir, { recursive: true })

let server: ReturnType<typeof spawn> | undefined

try {
	console.log(`[shots] Menyalakan server statis di porta ${PORT}…`)
	server = spawn(
		PYTHON,
		['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
		{ cwd: root, env, stdio: 'ignore' },
	)

	// Tunggu server siap (maks ~6 detik).
	let up = false
	for (let attempt = 0; attempt < 30; attempt += 1) {
		await sleep(200)
		if (await reachable()) {
			up = true
			break
		}
	}
	if (!up) {
		console.error(`[shots] Server tidak merespons di ${BASE}`)
		process.exit(1)
	}

	// Ukur dulu: preview.html melaporkan rect setiap kotak. PENTING — pass
	// pengukuran dan pass tangkapan harus memakai lebar jendela yang SAMA,
	// sebab flex-wrap menentukan berapa kolom; lebar berbeda = jumlah kolom
	// berbeda = koordinat berbeda. Lebar dipatok 3 kolom supaya stabil.
	const winW = COLS * COL_STRIDE + 40
	console.log('[shots] Mengukur tata letak…')
	const dom = spawnSync(
		CHROME,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--no-proxy-server',
			`--user-data-dir=${profileDir}`,
			`--window-size=${winW},1000`,
			'--virtual-time-budget=6000',
			'--dump-dom',
			BASE,
		],
		{ encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 },
	)

	const boxes = parseGeometry(dom.stdout ?? '')
	if (!boxes) {
		console.error('[shots] Tidak bisa membaca geometri dari preview.html.')
		process.exit(1)
	}
	writeFileSync(join(outDir, 'geometry.html'), dom.stdout ?? '', 'utf8')

	const bottom = Math.max(...boxes.map((b) => b.y + b.h))
	const height = bottom + 40

	console.log('[shots] Merender pratinjau dengan Chrome headless…')
	console.log(`        kanvas ${winW}x${height} untuk ${boxes.length} layar`)
	const fullPath = join(outDir, 'full.png')
	const result = spawnSync(
		CHROME,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-sandbox',
			'--no-proxy-server',
			`--user-data-dir=${profileDir}`,
			'--hide-scrollbars',
			`--window-size=${winW},${height}`,
			'--virtual-time-budget=6000',
			`--force-device-scale-factor=${SCALE}`,
			`--screenshot=${fullPath}`,
			BASE,
		],
		{ encoding: 'utf8', env },
	)

	if (!existsSync(fullPath)) {
		console.error('[shots] Gagal menangkap. Keluaran Chrome:')
		console.error(result.stderr?.slice(-800) ?? '(tidak ada)')
		process.exit(1)
	}

	console.log(`[shots] Layar penuh: ${fullPath}`)
	console.log(
		`[shots] ${boxes.length} layar pada ${POPUP_W}x${POPUP_H} (skala ${SCALE})`,
	)

	// Potong per layar supaya tiap berkas bisa dibuka langsung.
	const crop = spawnSync(
		PYTHON,
		[join(root, 'scripts', 'cropShots.py')],
		{ cwd: root, encoding: 'utf8', env },
	)
	if (crop.status === 0) {
		console.log(`[shots] Potongan per layar tersimpan di ${outDir}`)
	} else {
		console.warn('[shots] Pemotongan dilewati:', crop.stderr?.slice(-300))
	}
} finally {
	server?.kill()
}
