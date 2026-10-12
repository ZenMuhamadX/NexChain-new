/**
 * Konfigurasi electron-builder — mengemas shell desktop menjadi installer.
 *
 * Prinsip yang dipegang:
 *   1. `files` SENGAJA sempit. Hanya proses utama, preload, dan hasil build
 *      Vite yang masuk paket. `src/`, `scripts/`, `node_modules` root, dan
 *      berkas konfigurasi dev TIDAK ikut — installer tidak perlu membawa
 *      kode sumber wallet, dan bundel yang lebih kecil lebih sedikit celahnya.
 *   2. `asar: true` membungkus kode dalam arsip. Ini bukan enkripsi (siapa pun
 *      bisa membukanya), tapi mencegah penyalinan berkas asal-asalan.
 *   3. `extraMetadata.main` memaksa entry point ke jalur preload/main kita,
 *      supaya `package.json` di dalam asar tidak menunjuk ke tempat lain.
 *
 * Catatan: `dist/desktop` adalah hasil `vite build --mode desktop` dan HARUS
 * ada sebelum `electron-builder` dijalankan — karena itu script npm memanggil
 * `build:desktop` lebih dulu.
 */
module.exports = {
	appId: 'org.nexchain.wallet',
	productName: 'NexChain Wallet',
	copyright: 'Copyright © 2026 NexChain',
	// Direktori kerja relatif ke berkas ini (root package wallet/).
	directories: {
		output: 'release',
		buildResources: 'shells/desktop/build',
	},
	extraMetadata: {
		main: 'shells/desktop/electron/main.cjs',
	},
	files: [
		'shells/desktop/electron/**/*',
		'dist/desktop/**/*',
		'package.json',
		// Renderer adalah bundle Vite — React/buffer/qrcode/msgpack SUDAH
		// ter-inline ke dist/desktop/assets/*.js. Proses utama hanya memakai
		// `electron` + modul Node bawaan, jadi TIDAK ada dependensi runtime
		// yang perlu dibawa. Tanpa pengecualian ini, electron-builder menyalin
		// seluruh node_modules (370+ entri) dan membengkakkan installer
		// ratusan MB tanpa manfaat apa pun.
		'!node_modules/**/*',
		'!**/*.map',
		'!**/*.ts',
		'!src/**/*',
		'!scripts/**/*',
		'!release/**/*',
		'!tests/**/*',
	],
	// Vault disimpan di userData oleh proses utama; jangan pernah dikemas.
	asar: true,
	compression: 'maximum',
	win: {
		/**
		 * Dua bentuk distribusi dari build yang sama:
		 *
		 *   nsis     — installer biasa. Data di %APPDATA%, ikut aturan Windows,
		 *              muncul di Start Menu, dan aman dari penghapusan tak sengaja.
		 *   portable — SATU berkas .exe, tanpa instalasi. Dijalankan dari mana
		 *              saja (USB, folder mana pun). Data dibuat di subfolder
		 *              `NexChainWallet-Data/` di samping .exe — lihat
		 *              `PORTABLE_EXECUTABLE_DIR` di `electron/main.cjs`.
		 *
		 * Pilih sesuai kebutuhan; keduanya dihasilkan dari `bun run wallet:dist`.
		 */
		target: [
			{ target: 'nsis', arch: ['x64'] },
			{ target: 'portable', arch: ['x64'] },
		],
		artifactName: '${productName}-${version}-setup.${ext}',
	},
	portable: {
		// Portable tidak butuh hak admin: tidak menulis ke Program Files,
		// tidak menyentuh registry, tidak memasang layanan.
		requestExecutionLevel: 'user',
		artifactName: '${productName}-${version}-portable.${ext}',
		/**
		 * `unpackDirName` = nama folder SEMENTARA tempat .exe mengekstrak diri
		 * saat dijalankan. Bukan folder data vault — itu `NexChainWallet-Data/`
		 * yang dibuat proses utama di samping .exe.
		 */
		unpackDirName: 'NexChainWalletPortable',
	},
	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
		createDesktopShortcut: true,
		createStartMenuShortcut: true,
		shortcutName: 'NexChain Wallet',
		// PENTING: installer TIDAK boleh menghapus data pengguna saat uninstall.
		// Vault berisi dana; menghapusnya otomatis sama dengan kehilangan dana.
		deleteAppDataOnUninstall: false,
	},
	linux: {
		target: ['AppImage'],
		category: 'Finance',
	},
	mac: {
		target: ['dmg'],
		category: 'public.app-category.finance',
	},
}
