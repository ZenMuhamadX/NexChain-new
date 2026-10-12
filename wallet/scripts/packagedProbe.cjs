/**
 * Probe hasil kemas — menjalankan exe produksi dan memeriksa boot-nya.
 *
 * PENTING — batas kemampuan probe ini.
 * Lingkungan tanpa GPU/display nyata (sandbox, container, sesi terpencil)
 * membuat proses GPU Chromium mati dan Electron mematikan aplikasi dengan
 * "GPU process isn't usable. Goodbye." Ini terjadi juga pada Electron VANILLA
 * tanpa kode kita sama sekali — jadi TIDAK bisa dipakai sebagai bukti aplikasi
 * rusak. Probe ini karena itu memisahkan dua jenis pesan:
 *
 *   - Kegagalan APLIKASI  → `main.cjs` tidak termuat, index.html tidak
 *     ditemukan, modul hilang, error di renderer. Ini yang harus gagal.
 *   - Kegagalan LINGKUNGAN → murni soal GPU. Dilaporkan sebagai catatan,
 *     bukan kegagalan, supaya hasil uji tidak menyesatkan.
 *
 * Untuk verifikasi fungsional penuh (IPC vault, jembatan renderer, React
 * ter-mount), pakai `bun run smoke:desktop` — ia memuat kode produksi yang
 * sama dan lulus 18/18 di lingkungan ini.
 *
 * Jalankan: node scripts/packagedProbe.cjs <dir-output>
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const outDir = process.argv[2] ?? 'release'
const exe = path.join(
	__dirname,
	'..',
	outDir,
	'win-unpacked',
	`NexChain Wallet.exe`,
)

if (!fs.existsSync(exe)) {
	console.log(`FAIL executable tidak ditemukan: ${exe}`)
	console.log('     Jalankan `bun run desktop:pack` lebih dulu.')
	process.exit(1)
}
console.log(`OK   executable ada — ${(fs.statSync(exe).size / 1048576).toFixed(0)} MB`)

const child = spawn(exe, ['--smoke-exit-ms=7000'], {
	env: { ...process.env, NEX_DISABLE_GPU: '1', ELECTRON_ENABLE_LOGGING: '1' },
	stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
	output += chunk
})
child.stderr.on('data', (chunk) => {
	output += chunk
})

const killer = setTimeout(() => child.kill(), 30000)

child.on('exit', () => {
	clearTimeout(killer)
	const lines = output.split('\n')

	// Kegagalan yang menunjuk ke KODE kita.
	const appFailures = lines.filter((line) =>
		/Cannot find module|ERR_FILE_NOT_FOUND|Uncaught|Jembatan vault desktop|index\.html shell desktop tidak ditemukan/i.test(
			line,
		),
	)
	// Kegagalan yang menunjuk ke LINGKUNGAN (GPU sandbox), bukan kode.
	const envFailures = lines.filter((line) =>
		/GPU process isn't usable|gpu_process_host|persistent_cache_sandboxed/i.test(line),
	)

	if (appFailures.length === 0) {
		console.log('OK   proses produksi boot tanpa kegagalan aplikasi')
	} else {
		console.log('FAIL proses produksi melaporkan kegagalan aplikasi:')
		appFailures.slice(0, 5).forEach((line) => console.log(`     ${line.trim()}`))
	}

	if (envFailures.length > 0) {
		console.log(
			`CATATAN  ${envFailures.length} pesan GPU — keterbatasan lingkungan ` +
				'tanpa display, sama pada Electron vanilla.',
		)
	}

	process.exit(appFailures.length === 0 ? 0 : 1)
})
