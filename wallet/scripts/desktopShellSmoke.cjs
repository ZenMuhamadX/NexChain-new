/**
 * Smoke test shell desktop Electron — memuat berkas produksi apa adanya.
 *
 * Memuat `shells/desktop/electron/main.cjs` yang ASLI (bukan salinan) supaya
 * yang diuji benar-benar kode yang dikirim. Yang diperiksa:
 *
 *   A. Proses utama — 4 handler IPC terdaftar, dan operasi vault bekerja
 *      sungguhan di disk (tulis → baca → hapus), termasuk penolakan kunci
 *      berbahaya (path traversal, huruf besar).
 *   B. Renderer — jendela benar-benar memuat `dist/desktop`, preload memasang
 *      `window.nexVaultBridge`, dan empat method ada & bisa dipanggil dari
 *      konteks renderer (bukti `contextIsolation` tidak memutus jembatan).
 *
 * Catatan: dijalankan dengan `ELECTRON_RUN_AS_NODE` DIHAPUS. Bila env itu
 * diset, Electron berjalan sebagai Node biasa dan `require('electron')`
 * mengembalikan path executable (string) — bukan API.
 *
 * Jalankan: bun run wallet:smoke:desktop
 */
const path = require('node:path')
const fs = require('node:fs')

const {
	app,
	BrowserWindow,
	ipcMain,
	ipcRenderer,
	contextBridge,
} = require('electron')

const results = []
const check = (name, ok, detail) =>
	results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)

const walletRoot = path.join(__dirname, '..')
const mainPath = path.join(walletRoot, 'shells/desktop/electron/main.cjs')
const preloadPath = path.join(walletRoot, 'shells/desktop/electron/preload.cjs')
const indexHtml = path.join(
	walletRoot,
	'dist/desktop/shells/desktop/index.html',
)

// Jangan tampilkan jendela selama pengujian.
const realOnce = BrowserWindow.prototype.once
BrowserWindow.prototype.once = function (event, cb) {
	if (event === 'ready-to-show') return this
	return realOnce.call(this, event, cb)
}

// Tangkap handler yang didaftarkan main.cjs agar bisa dipanggil langsung.
const handlers = new Map()
const realHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, fn) => {
	handlers.set(channel, fn)
	return realHandle(channel, fn)
}

app.setName('NexChain Wallet Smoke')

// Lingkungan uji sering tanpa GPU/display nyata: proses GPU Crashpad bisa
// membunuh seluruh app ("GPU process isn't usable. Goodbye."). Untuk smoke
// test kita tidak butuh GPU — matikan akselerasi dan sandbox GPU.
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('no-sandbox')

// Muat kode produksi SEBELUM app siap — persis seperti `electron .`.
require(mainPath)

app
	.whenReady()
	.then(async () => {
		await new Promise((resolve) => setTimeout(resolve, 700))

		// ── A. Proses utama ────────────────────────────────────────────────
		check('main.cjs mendaftarkan 4 handler IPC', handlers.size === 4, `${handlers.size}/4`)

		const dataDir = await handlers.get('vault:dataDir')(null)
		check(
			'dataDir di dalam userData (bukan di sebelah executable)',
			dataDir.endsWith(path.join('NexChain Wallet', 'wallet')),
			dataDir,
		)

		const payload = JSON.stringify({ v: 1, address: 'NxCTest', blob: 'a'.repeat(500) })
		await handlers.get('vault:write')(null, 'primary', payload)
		const vaultFile = path.join(dataDir, 'primary.json')
		check('tulis vault → berkas nyata di disk', fs.existsSync(vaultFile))

		const readBack = await handlers.get('vault:read')(null, 'primary')
		check('baca vault → isi identik', readBack === payload)

		const missing = await handlers.get('vault:read')(null, 'belum-ada')
		check('baca kunci tak ada → undefined, bukan throw', missing === undefined)

		let traversalRejected = false
		try {
			await handlers.get('vault:write')(null, '../../jahat', 'x')
		} catch {
			traversalRejected = true
		}
		check('tolak kunci path-traversal', traversalRejected)
		check(
			'berkas traversal TIDAK tercipta',
			!fs.existsSync(path.join(dataDir, '..', '..', 'jahat.json')),
		)

		let caseRejected = false
		try {
			await handlers.get('vault:write')(null, 'Primary', 'x')
		} catch {
			caseRejected = true
		}
		check('tolak kunci non-lowercase', caseRejected)

		let tooBigRejected = false
		try {
			await handlers.get('vault:write')(null, 'primary', 'z'.repeat(2 * 1024 * 1024))
		} catch {
			tooBigRejected = true
		}
		check('tolak nilai melebihi 1 MiB', tooBigRejected)

		// ── B. Renderer ────────────────────────────────────────────────────
		if (!fs.existsSync(indexHtml)) {
			check('dist/desktop ada (jalankan build:desktop dulu)', false, indexHtml)
		} else {
			const win = new BrowserWindow({
				show: false,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
					sandbox: true,
					webSecurity: true,
					preload: preloadPath,
				},
			})

			let loadFailed = undefined
			win.webContents.on('did-fail-load', (_e, code, desc, url) => {
				loadFailed = `${code} ${desc} :: ${url}`
			})

			let loaded = false
			try {
				await win.loadFile(indexHtml)
				loaded = true
			} catch (error) {
				// Windows kadang menolak `loadFile` untuk path berpola
				// file:///C:\... — coba lewat URL file eksplisit sebagai
				// fallback sebelum menyatakan renderer gagal.
				try {
					const { pathToFileURL } = require('node:url')
					await win.loadURL(pathToFileURL(indexHtml).toString())
					loaded = true
					loadFailed = undefined
				} catch (retryError) {
					loadFailed = `${String(error)} | retry: ${String(retryError)}`
				}
			}

			if (loaded) await new Promise((resolve) => setTimeout(resolve, 2500))

			check('renderer memuat dist/desktop tanpa gagal', loaded, loadFailed ?? '')

			// Preload jalan di konteks terisolasi; `executeJavaScript` berjalan
			// di konteks UTAMA (main world) — jadi ini membuktikan jembatan
			// benar-benar menyeberang lewat contextBridge, bukan hanya ada di preload.
			const bridgeShape = await win.webContents.executeJavaScript(`
				(() => {
					const b = window.nexVaultBridge
					if (!b) return { present: false }
					return {
						present: true,
						read: typeof b.read,
						write: typeof b.write,
						remove: typeof b.remove,
						dataDir: typeof b.dataDir,
						nodeLeak: typeof require,
						processLeak: typeof process,
					}
				})()
			`)

			check('window.nexVaultBridge terlihat dari renderer', bridgeShape.present === true)
			check(
				'empat method terpasang & bertipe function',
				['read', 'write', 'remove', 'dataDir'].every(
					(k) => bridgeShape[k] === 'function',
				),
				`read=${bridgeShape.read} write=${bridgeShape.write} remove=${bridgeShape.remove} dataDir=${bridgeShape.dataDir}`,
			)
			check(
				'require TIDAK bocor ke renderer (nodeIntegration off)',
				bridgeShape.nodeLeak === 'undefined',
				bridgeShape.nodeLeak ?? '',
			)
			check(
				'process TIDAK bocor ke renderer (contextIsolation on)',
				bridgeShape.processLeak === 'undefined',
				bridgeShape.processLeak ?? '',
			)

			// Renderer benar-benar bisa menulis lewat jembatan → membuktikan
			// jalur renderer → preload → main → disk utuh.
			const roundTrip = await win.webContents.executeJavaScript(`
				(async () => {
					try {
						await window.nexVaultBridge.write('rndtest', JSON.stringify({ from: 'renderer' }))
						const raw = await window.nexVaultBridge.read('rndtest')
						const dir = await window.nexVaultBridge.dataDir()
						await window.nexVaultBridge.remove('rndtest')
						return { ok: true, raw, dir }
					} catch (error) {
						return { ok: false, error: String(error) }
					}
				})()
			`)
			check(
				'renderer → preload → main → disk pulang-pergi bekerja',
				roundTrip.ok === true,
				roundTrip.error ?? '',
			)
			check(
				'dataDir dari renderer cocok dengan proses utama',
				roundTrip.dir === dataDir,
			)

			// Bukti React benar-benar mount: #root tidak kosong.
			const rootHtml = await win.webContents.executeJavaScript(
				`document.getElementById('root')?.childElementCount ?? 0`,
			)
			check('React ter-mount (#root berisi elemen)', rootHtml > 0, `${rootHtml} elemen`)

			// Boot gagal keras bila jembatan hilang → pastikan TIDAK terjadi.
			const bootError = await win.webContents.executeJavaScript(
				`document.body.innerText.includes('Jembatan vault desktop tidak tersedia')`,
			)
			check('tidak ada error boot "jembatan tidak tersedia"', bootError === false)

			win.destroy()
		}

		// ── Bersihkan ──────────────────────────────────────────────────────
		try {
			await handlers.get('vault:remove')(null, 'primary')
		} catch {
			/* sudah tidak ada */
		}

		console.log(`\n${results.join('\n')}`)
		const failed = results.filter((line) => line.startsWith('FAIL')).length
		console.log(`\n${results.length - failed} OK / ${failed} FAIL\n`)
		app.exit(failed === 0 ? 0 : 1)
	})
	.catch((error) => {
		console.error('SMOKE ERROR:', error)
		app.exit(2)
	})
