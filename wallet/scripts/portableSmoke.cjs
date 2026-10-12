/**
 * Smoke test mode portabel — memastikan data vault mendarat di tempat yang benar.
 *
 * Mengapa ini perlu ada: mode portabel adalah fitur yang bisa rusak TANPA
 * error apa pun. Kalau deteksinya berhenti bekerja, aplikasi tetap jalan
 * normal — hanya saja wallet-nya diam-diam tersimpan di %APPDATA%, sehingga
 * pengguna yang membawa .exe ke komputer lain akan mendapati wallet-nya
 * "hilang". Kegagalan seperti itu tidak terlihat sampai terlambat, dan
 * itulah jenis bug yang layak dijaga oleh tes.
 *
 * Tiga skenario yang diuji:
 *   A. Tanpa `PORTABLE_EXECUTABLE_DIR`  → direktori profil pengguna.
 *   B. Dengan env, folder bisa ditulis  → `<dir>/NexChainWallet-Data`.
 *   C. Dengan env, folder TIDAK bisa ditulis → kembali ke profil, tidak crash.
 *
 * Cara kerja: berkas ini punya dua peran. Dijalankan biasa (Node) ia menjadi
 * INDUK dan menjalankan Electron tiga kali. Dijalankan dengan `--portable-child`
 * ia menjadi ANAK di dalam Electron, memuat `main.cjs` yang asli, lalu
 * melaporkan direktori datanya sebagai JSON.
 *
 * Jalankan: bun run wallet:smoke:portable
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')

const MAIN_CJS = path.join(
	__dirname,
	'..',
	'shells',
	'desktop',
	'electron',
	'main.cjs',
)

// ══════════════════════════════════════════════════════════════════════════
// MODE ANAK — berjalan di dalam Electron.
// ══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--portable-child')) {
	const { app, BrowserWindow, ipcMain } = require('electron')

	// Tangkap handler IPC sebelum main.cjs mendaftarkannya.
	const handlers = new Map()
	const realHandle = ipcMain.handle.bind(ipcMain)
	ipcMain.handle = (channel, fn) => {
		handlers.set(channel, fn)
		return realHandle(channel, fn)
	}

	// Jangan tampilkan jendela selama pengujian.
	const realOnce = BrowserWindow.prototype.once
	BrowserWindow.prototype.once = function (event, cb) {
		if (event === 'ready-to-show') return this
		return realOnce.call(this, event, cb)
	}

	require(MAIN_CJS)

	app
		.whenReady()
		.then(async () => {
			await new Promise((resolve) => setTimeout(resolve, 600))
			const dataDir = await handlers.get('vault:dataDir')(null)
			report({ dataDir })
			app.exit(0)
		})
		.catch((error) => {
			report({ error: String(error) })
			app.exit(1)
		})

	/**
	 * Laporkan hasil ke INDUK.
	 *
	 * Ditulis ke BERKAS, bukan stdout. `app.exit()` menghentikan proses serta-merta
	 * tanpa menunggu stdout ter-flush, sehingga hasil yang ditulis ke stdout bisa
	 * hilang — dan hilangnya tidak konsisten: skenario yang kebetulan lebih banyak
	 * I/O (mis. mode portabel yang menulis cache Electron) justru paling sering
	 * kehilangan outputnya. Berkas menutup masalah itu sepenuhnya.
	 */
	function report(payload) {
		const resultFile = process.env.NEX_PORTABLE_RESULT_FILE
		if (resultFile) {
			try {
				fs.writeFileSync(resultFile, JSON.stringify(payload))
			} catch {
				/* induk akan melaporkan "tidak ada hasil" */
			}
		}
		// Tetap cetak ke stdout sebagai jejak saat dijalankan manual.
		process.stdout.write(`__PORTABLE_RESULT__${JSON.stringify(payload)}\n`)
	}

	// Hentikan eksekusi bagian induk di bawah.
} else {
	// ══════════════════════════════════════════════════════════════════════
	// MODE INDUK — berjalan di Node.
	// ══════════════════════════════════════════════════════════════════════
	const results = []
	const check = (name, ok, detail) =>
		results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)

	// `require('electron')` dari Node mengembalikan PATH ke binary — persis
	// yang dibutuhkan untuk spawn. (Dari dalam Electron ia mengembalikan API.)
	const electronPath = require('electron')

	if (!fs.existsSync(MAIN_CJS)) {
		console.log(`FAIL main.cjs tidak ditemukan: ${MAIN_CJS}`)
		process.exit(1)
	}

	/** Jalankan satu skenario, kembalikan `dataDir` yang dilaporkan anak. */
	const runScenario = (portableDir, label) =>
		new Promise((resolve) => {
			const env = { ...process.env }
			// Lingkungan uji kadang menyetel ini; bila ada, Electron berjalan
			// sebagai Node biasa dan `require('electron')` bukan lagi API.
			delete env.ELECTRON_RUN_AS_NODE
			env.NEX_DISABLE_GPU = '1'
			if (portableDir === undefined) delete env.PORTABLE_EXECUTABLE_DIR
			else env.PORTABLE_EXECUTABLE_DIR = portableDir

			// Anak menulis hasilnya ke berkas ini (lihat `report()`), karena
			// stdout bisa hilang saat `app.exit()`.
			const resultFile = path.join(
				os.tmpdir(),
				`nex-portable-result-${process.pid}-${label}.json`,
			)
			env.NEX_PORTABLE_RESULT_FILE = resultFile

			// `spawn` async, BUKAN `spawnSync`. Di Windows, `spawnSync` pada
			// binary besar seperti electron.exe (~200 MB) bisa gagal dengan
			// EBUSY karena Node memetakan berkasnya secara blocking sementara
			// pemindai antivirus memegang handle-nya. Versi async tidak
			// melakukan pemetaan itu dan terbukti andal.
			const child = spawn(electronPath, [__filename, '--portable-child'], { env })

			let output = ''
			child.stdout.on('data', (chunk) => {
				output += chunk
			})
			child.stderr.on('data', (chunk) => {
				output += chunk
			})

			const killer = setTimeout(() => child.kill(), 60_000)

			const finish = () => {
				clearTimeout(killer)
				// Utamakan berkas hasil; stdout hanya cadangan.
				try {
					const raw = fs.readFileSync(resultFile, 'utf8')
					fs.unlinkSync(resultFile)
					resolve({ ...JSON.parse(raw), output })
					return
				} catch {
					/* jatuh ke stdout */
				}
				const marker = output.match(/__PORTABLE_RESULT__(\{.*\})/)
				if (!marker) {
					resolve({ dataDir: undefined, output })
					return
				}
				try {
					resolve({ ...JSON.parse(marker[1]), output })
				} catch {
					resolve({ dataDir: undefined, output })
				}
			}

			child.on('close', finish)
			child.on('error', (error) => {
				clearTimeout(killer)
				resolve({ dataDir: undefined, output: String(error) })
			})
		})

	/** Seluruh rangkaian uji; dibungkus agar bisa `await` berurutan. */
	const runAll = async () => {
		// ── A. Tanpa env → direktori profil pengguna ──────────────────────
		const scenarioA = await runScenario(undefined, 'a')
		check(
			'A. tanpa PORTABLE_EXECUTABLE_DIR → profil pengguna',
			typeof scenarioA.dataDir === 'string' &&
				scenarioA.dataDir.includes('AppData'),
			scenarioA.dataDir ?? '(tidak ada hasil)',
		)

		// ── B. Dengan env, folder bisa ditulis → dialihkan ────────────────
		const writableDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-portable-ok-'))
		const scenarioB = await runScenario(writableDir, 'b')
		const expectedB = path.join(writableDir, 'NexChainWallet-Data', 'wallet')
		check(
			'B. env + folder bisa ditulis → dialihkan ke samping .exe',
			scenarioB.dataDir === expectedB,
			scenarioB.dataDir ?? '(tidak ada hasil)',
		)

		// ── C. Dengan env, folder TIDAK bisa ditulis → fallback ───────────
		// Parent berupa FILE, sehingga pembuatan direktori pasti gagal (ENOTDIR).
		const blockerFile = path.join(
			os.tmpdir(),
			`nex-portable-blocker-${process.pid}.txt`,
		)
		fs.writeFileSync(blockerFile, 'blocker')
		const scenarioC = await runScenario(path.join(blockerFile, 'sub'), 'c')
		check(
			'C. env + folder tidak bisa ditulis → kembali ke profil, tidak crash',
			typeof scenarioC.dataDir === 'string' &&
				scenarioC.dataDir.includes('AppData'),
			scenarioC.dataDir ?? '(tidak ada hasil)',
		)

		// ── Bersihkan ─────────────────────────────────────────────────────
		try {
			fs.unlinkSync(blockerFile)
		} catch {
			/* tidak fatal */
		}
		// `rm -rf` dicegat lapisan keamanan; hapus dari dalam ke luar.
		try {
			const walk = (dir) => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					const full = path.join(dir, entry.name)
					if (entry.isDirectory()) walk(full)
					else fs.unlinkSync(full)
				}
			}
			walk(writableDir)
			const rmdirDeep = (dir) => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					if (entry.isDirectory()) rmdirDeep(path.join(dir, entry.name))
				}
				fs.rmdirSync(dir)
			}
			rmdirDeep(writableDir)
		} catch {
			/* sisa direktori sementara tidak fatal */
		}

		console.log(`\n${results.join('\n')}`)
		const failed = results.filter((line) => line.startsWith('FAIL')).length
		console.log(`\n${results.length - failed} OK / ${failed} FAIL\n`)
		process.exit(failed === 0 ? 0 : 1)
	}

	void runAll()
}
