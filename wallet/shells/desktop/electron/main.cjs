/**
 * Proses utama Electron — jendela + penyimpanan vault.
 *
 * Pembagian tugas yang tegas:
 *   1. PROSES INI yang tahu di mana berkas vault disimpan.
 *   2. RENDERER tidak pernah menyentuh filesystem; ia hanya boleh memanggil
 *      empat operasi lewat `window.nexVaultBridge` (dipasang `preload.cjs`).
 *
 * ── Dua mode distribusi ───────────────────────────────────────────────────
 *
 * TERPASANG (installer NSIS) — data di direktori profil pengguna:
 *     Windows : %APPDATA%\NexChain Wallet
 *     macOS   : ~/Library/Application Support/NexChain Wallet
 *     Linux   : ~/.config/NexChain Wallet
 * Direktori ini tidak ikut terhapus saat update, dan tidak read-only seperti
 * direktori pemasangan. Karena itu berkas vault TIDAK diletakkan di sebelah
 * executable pada mode ini.
 *
 * PORTABEL (satu .exe, tanpa instalasi) — data di samping executable, dalam
 * subfolder `NexChainWallet-Data/`. Ini yang membuatnya benar-benar portabel:
 * pindahkan .exe DAN foldernya ke USB, wallet ikut. Bila datanya dibiarkan di
 * %APPDATA%, aplikasi "portabel" tetap akan kehilangan wallet saat dibuka di
 * komputer lain — jebakan yang justru paling mudah menjebak pengguna.
 *
 * Subfolder dipakai, bukan folder .exe itu sendiri, supaya: (a) tidak
 * tercampur dengan berkas lain bila .exe ditaruh di folder Downloads, dan
 * (b) bisa dihapus/di-backup terpisah dari aplikasinya.
 *
 * ── Mengapa CJS, bukan ESM ────────────────────────────────────────────────
 * Proses utama Electron berjalan di Node; dukungan ESM-nya masih terbatas
 * dan bentuk `require` untuk `electron` lebih dapat diandalkan lintas versi.
 * Paket `wallet/` bertipe `"module"`, jadi berkas ini sengaja berekstensi
 * `.cjs` supaya dimuat sebagai CommonJS.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs/promises')
// Varian sinkron dipakai sekali saat boot (resolusi path), bukan di jalur IPC.
const fsSync = require('node:fs')
const path = require('node:path')

/**
 * Nama profil. Bila diubah setelah rilis, wallet pengguna lama akan terlihat
 * "hilang" karena Electron mencari data di folder baru.
 */
const USER_DATA_DIR_NAME = 'NexChain Wallet'
const VAULT_SUBDIR = 'wallet'

/** Nama folder data yang dibuat di samping .exe saat mode portabel. */
const PORTABLE_DATA_DIR_NAME = 'NexChainWallet-Data'

/**
 * Batas ukuran satu nilai. Vault terenkripsi hanya beberapa KB; batas ini
 * murni pengaman agar bug di renderer tidak menulis berkas raksasa ke disk.
 */
const MAX_VALUE_BYTES = 1 << 20 // 1 MiB

/**
 * Kunci yang diizinkan. Renderer tidak boleh menulis berkas sembarangan —
 * hanya nama logis yang sudah dikenal, dan selalu di dalam `walletDir`.
 */
const ALLOWED_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Dev murni: muat dari Vite dev server. Selain itu: berkas build. */
const isDev = process.argv.includes('--dev')
// Entry shell pindah ke shells/desktop/ (refactor penggabungan wallet-ui) —
// root server tidak lagi punya index.html sendiri, jadi path-nya eksplisit.
const DEV_SERVER_URL =
	process.env.NEX_DEV_SERVER ?? 'http://localhost:5174/shells/desktop/'

let walletDir = ''
let mainWindow = null

/** Resolusi path berkas untuk sebuah kunci logis. Melempar bila kunci ilegal. */
const resolveKeyPath = (key) => {
	if (typeof key !== 'string' || !ALLOWED_KEY.test(key)) {
		throw new Error(`Kunci vault tidak valid: ${String(key)}`)
	}
	const target = path.join(walletDir, `${key}.json`)
	// Sabuk pengaman kedua: pastikan hasil akhir masih di dalam walletDir
	// (jangan pernah percaya bahwa regex sudah cukup).
	if (!path.resolve(target).startsWith(path.resolve(walletDir) + path.sep)) {
		throw new Error('Path vault keluar dari direktori data.')
	}
	return target
}

/**
 * Tulis atomik: tulis ke berkas sementara, `fsync`, lalu `rename`.
 *
 * Tanpa ini, mati listrik saat menulis bisa menyisakan berkas JSON separuh —
 * vault menjadi rusak dan frasa pemulihan harus dipakai. `rename` pada
 * volume yang sama bersifat atomik, jadi berkas lama tetap utuh sampai
 * penggantinya benar-benar selesai ditulis.
 */
const writeAtomic = async (target, contents) => {
	const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
	const handle = await fs.open(tmp, 'w')
	try {
		await handle.writeFile(contents, 'utf8')
		// `sync` memastikan byte benar-benar sampai ke disk sebelum rename.
		await handle.sync()
	} finally {
		await handle.close()
	}
	await fs.rename(tmp, target)
}

const registerVaultIpc = () => {
	ipcMain.handle('vault:read', async (_event, key) => {
		try {
			const contents = await fs.readFile(resolveKeyPath(key), 'utf8')
			return contents
		} catch (error) {
			// "Tidak ada" BUKAN kegagalan: renderer memakainya untuk
			// menampilkan layar setup. Kegagalan lain tetap dilempar.
			if (error && error.code === 'ENOENT') return undefined
			throw error
		}
	})

	ipcMain.handle('vault:write', async (_event, key, value) => {
		if (typeof value !== 'string') {
			throw new Error('Nilai vault harus berupa string.')
		}
		if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
			throw new Error('Nilai vault melebihi batas ukuran.')
		}
		await fs.mkdir(walletDir, { recursive: true })
		await writeAtomic(resolveKeyPath(key), value)
	})

	ipcMain.handle('vault:remove', async (_event, key) => {
		try {
			await fs.unlink(resolveKeyPath(key))
		} catch (error) {
			if (error && error.code === 'ENOENT') return
			throw error
		}
	})

	ipcMain.handle('vault:dataDir', () => walletDir)
}

/**
 * Cari `dist/desktop/shells/desktop/index.html` terlepas dari tata letaknya.
 *
 * Mengapa tidak sekadar `path.join(__dirname, '..', 'dist', ...)`:
 * kedalaman relatif BERBEDA antara dev dan hasil kemas.
 *     dev      : <wallet>/shells/desktop/electron/  → butuh ../../../
 *     dikemas  : resources/app.asar/shells/desktop/electron/ → juga ../../../
 * Keduanya sebenarnya sama, TAPI berkas hasil build Vite berada di
 * `<wallet>/dist/...` sedangkan proses utama ada tiga tingkat di bawahnya.
 * Menuliskan `../../..` begitu saja akan pecah begitu struktur bergeser lagi.
 *
 * Jadi kita naik beberapa tingkat dan berhenti di direktori pertama yang
 * benar-benar berisi berkasnya. Kalau tidak ketemu, error-nya menyebut semua
 * lokasi yang dicoba — jauh lebih mudah didiagnosis daripada "file not found".
 */
const resolveShellHtml = () => {
	const candidates = []
	let dir = __dirname
	for (let up = 0; up < 5; up += 1) {
		candidates.push(
			path.join(dir, 'dist', 'desktop', 'shells', 'desktop', 'index.html'),
		)
		dir = path.dirname(dir)
	}
	// Path relatif terhadap root app (cara paling eksplisit untuk hasil kemas).
	candidates.push(
		path.join(app.getAppPath(), 'dist', 'desktop', 'shells', 'desktop', 'index.html'),
	)

	for (const candidate of candidates) {
		if (fsSync.existsSync(candidate)) return candidate
	}
	throw new Error(
		'index.html shell desktop tidak ditemukan. Lokasi yang dicoba:\n' +
			candidates.map((c) => `  - ${c}`).join('\n') +
			'\nJalankan `bun run build:desktop` sebelum menjalankan aplikasi.',
	)
}

const createWindow = () => {
	mainWindow = new BrowserWindow({
		width: 480,
		height: 820,
		minWidth: 380,
		minHeight: 620,
		// Tampilkan jendela setelah frame pertama siap; menghindari kedipan
		// putih saat bundle React masih dimuat.
		show: false,
		backgroundColor: '#0b0d12',
		title: 'NexChain Wallet',
		autoHideMenuBar: true,
		webPreferences: {
			// WAJIB. `true` memberi renderer akses Node penuh — halaman apa
			// pun yang berhasil menyuntik skrip akan bisa menulis filesystem
			// dan membaca mnemonic dari memori proses.
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			preload: path.join(__dirname, 'preload.cjs'),
		},
	})

	mainWindow.once('ready-to-show', () => mainWindow.show())

	// Tautan eksternal dibuka di browser sistem, BUKAN di dalam wallet —
	// jendela wallet tidak boleh dinavigasi ke halaman pihak ketiga.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('http://') || url.startsWith('https://')) {
			void shell.openExternal(url)
		}
		return { action: 'deny' }
	})

	// Blokir navigasi seluruh jendela keluar dari origin-nya sendiri.
	mainWindow.webContents.on('will-navigate', (event, url) => {
		const current = mainWindow.webContents.getURL()
		if (url !== current) event.preventDefault()
	})

	if (isDev) {
		void mainWindow.loadURL(DEV_SERVER_URL)
		mainWindow.webContents.openDevTools({ mode: 'detach' })
	} else {
		// Hasil `vite build --mode desktop`, dicari lintas tata letak (dev &
		// dikemas) oleh `resolveShellHtml`.
		void mainWindow.loadFile(resolveShellHtml())
	}

	mainWindow.on('closed', () => {
		mainWindow = null
	})
}

/**
 * Sakelar lingkungan — hanya untuk otomasi/uji, bukan untuk pengguna.
 *
 * WAJIB dipasang SEBELUM baris Electron mana pun yang menyentuh `app`
 * (termasuk `app.setName`). Chromium membaca switch GPU saat proses GPU
 * pertama kali disiapkan; memanggil `app.commandLine.appendSwitch` setelahnya
 * tidak berpengaruh apa-apa.
 *
 * `NEX_DISABLE_GPU=1` mematikan akselerasi GPU. Diperlukan di lingkungan
 * tanpa GPU/display nyata (CI, container, sesi terpencil): proses GPU
 * Chromium crash dan Electron mematikan SELURUH aplikasi dengan pesan
 * "GPU process isn't usable. Goodbye." — sehingga wallet tidak pernah tampil.
 * Wallet ini hanya menggambar UI 2D sederhana, jadi tidak ada yang hilang.
 *
 * Catatan: `disable-gpu` SENDIRI TIDAK CUKUP di Electron 44. Chromium tetap
 * menjalankan proses GPU untuk compositing, dan di lingkungan tanpa display
 * proses itu tetap crash dan tetap membunuh aplikasi. `disable-gpu-sandbox`
 * yang membuatnya benar-benar berhenti mencoba. Ini hanya aktif saat
 * `NEX_DISABLE_GPU=1`, jadi postur keamanan normal tidak terpengaruh.
 */
if (process.env.NEX_DISABLE_GPU === '1') {
	app.commandLine.appendSwitch('disable-gpu')
	app.commandLine.appendSwitch('disable-gpu-compositing')
	app.commandLine.appendSwitch('disable-gpu-sandbox')
	app.commandLine.appendSwitch('disable-software-rasterizer')
	app.commandLine.appendSwitch('disable-dev-shm-usage')
	app.disableHardwareAcceleration()
}

/**
 * `--smoke-exit-ms=N` menutup aplikasi sendiri setelah N milidetik; dipakai
 * `scripts/desktopShellSmoke.cjs` dan probe hasil kemas agar proses tidak
 * menggantung saat dijalankan tanpa interaksi.
 */
const smokeExitArg = process.argv.find((arg) => arg.startsWith('--smoke-exit-ms='))
const smokeExitMs = smokeExitArg ? Number(smokeExitArg.split('=')[1]) : 0

// Nama profil harus diset SEBELUM `app.whenReady()`, kalau tidak Electron
// memakai nama dari package.json dan path data berbeda dari yang didokumentasi.
app.setName(USER_DATA_DIR_NAME)

/**
 * Deteksi mode portabel.
 *
 * `PORTABLE_EXECUTABLE_DIR` diset oleh launcher `portable` milik
 * electron-builder (dan hanya olehnya), berisi folder tempat .exe portabel
 * berada. Bila ada, kita alihkan direktori data ke samping .exe.
 *
 * `app.setPath` WAJIB dipanggil sebelum `app.whenReady()`: Electron menyimpan
 * path ini sekali saat inisialisasi, dan mengubahnya setelahnya tidak lagi
 * berpengaruh.
 *
 * Kalau folder tujuan tidak bisa ditulis (mis. .exe diletakkan di CD-ROM,
 * folder jaringan read-only, atau Program Files tanpa izin), kita JANGAN
 * gagal boot. Kita jatuh kembali ke profil pengguna normal dan memberi tahu
 * lewat konsol — aplikasi tetap jalan, dan pengguna tidak kehilangan akses.
 */
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
let usingPortableData = false

if (portableDir) {
	const portableDataDir = path.join(portableDir, PORTABLE_DATA_DIR_NAME)
	try {
		fsSync.mkdirSync(portableDataDir, { recursive: true })

		/**
		 * Uji tulis sungguhan: `mkdirSync` berhasil pada folder yang sudah ada
		 * meski folder itu read-only (mis. sisa dari CD-ROM atau folder
		 * jaringan), dan kegagalan baru muncul saat menulis berkas.
		 *
		 * Penghapusan berkas probe sengaja dipisah dan kegagalannya DIABAIKAN.
		 * Alasannya penting: kalau `unlink` ikut berada di blok `try` yang
		 * sama, antivirus yang mengunci berkas sesaat akan membuat kita salah
		 * menyimpulkan "folder tidak bisa ditulis" — lalu diam-diam beralih ke
		 * %APPDATA%. Bagi pengguna portabel, itu berarti wallet mereka
		 * seolah hilang. Menulis berhasil sudah cukup sebagai bukti.
		 */
		const probe = path.join(portableDataDir, '.write-test')
		fsSync.writeFileSync(probe, 'ok')
		try {
			fsSync.unlinkSync(probe)
		} catch {
			// Berkas kecil tertinggal; tidak fatal dan tidak menghalangi apa pun.
		}

		app.setPath('userData', portableDataDir)
		usingPortableData = true
	} catch (error) {
		console.error(
			`[NexChain Wallet] Mode portabel diminta, tetapi "${portableDataDir}" ` +
				`tidak dapat ditulis (${error.code ?? error.message}). ` +
				'Beralih ke direktori data pengguna biasa.',
		)
	}
}

app.whenReady().then(() => {
	walletDir = path.join(app.getPath('userData'), VAULT_SUBDIR)
	if (usingPortableData) {
		// Sengaja dicetak: saat mode portabel, pengguna HARUS tahu di mana
		// dananya tersimpan — itulah satu-satunya hal yang perlu mereka
		// pindahkan/di-backup bersama .exe.
		console.log(`[NexChain Wallet] Mode portabel — data di ${walletDir}`)
	}
	registerVaultIpc()
	createWindow()

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})

	if (smokeExitMs > 0) setTimeout(() => app.quit(), smokeExitMs)
})

// macOS: aplikasi lazim tetap hidup tanpa jendela. Windows/Linux: keluar.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
