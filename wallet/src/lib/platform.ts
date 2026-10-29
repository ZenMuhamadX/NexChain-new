/**
 * TITIK SUNTIK 4 — status aplikasi terpasang (PWA).
 *
 * Tiga titik suntik lain (`vaultStore`, `deviceCrypto`, `rpcUrl`) menjawab
 * "di mana data disimpan", "seberapa kuat PBKDF2", dan "node mana yang dipakai".
 * Yang ini menjawab pertanyaan yang hanya masuk akal di browser: apakah wallet
 * ini sudah dipasang sebagai aplikasi, apakah penyimpanannya persisten, dan
 * apakah ada versi baru yang menunggu.
 *
 * KENAPA store, bukan prop: kartu "Aplikasi" di Settings dan banner update
 * dirender di tempat berbeda, dan statusnya berubah karena EVENT BROWSER
 * (`beforeinstallprompt`, `appinstalled`, `waiting`) — bukan karena aksi React.
 * Dengan store kecil ini, layar tetap tidak tahu platform apa yang menjalankannya.
 *
 * Shell web (`shells/web/main.tsx`) memanggil `installPlatform()` SEBELUM render
 * pertama. Shell dev dan desktop tidak memanggil apa pun, sehingga
 * `supported === false` dan kartu "Aplikasi" otomatis tidak dirender — termasuk
 * di build desktop, yang tidak pernah menyentuh `virtual:pwa-register`.
 *
 * Ini murni status presentasi: tidak ada kunci, mnemonic, atau transaksi yang
 * melewatinya.
 */

/** Bagaimana cara memasang aplikasi, menurut shell yang menjalankannya. */
export type InstallHint =
	/** Sudah berjalan sebagai aplikasi terpasang. */
	| 'installed'
	/** Browser menyediakan prompt pemasangan (`beforeinstallprompt` sudah tiba). */
	| 'prompt'
	/** iOS/iPadOS: hanya Safari, lewat Bagikan → Tambah ke Layar Utama. */
	| 'ios'
	/** Browser lain: lewat menu (⋮ → Instal aplikasi / Tambahkan ke layar utama). */
	| 'menu'
	/** Shell tidak mendukung pemasangan (dev/desktop). */
	| 'unsupported'

/** Status penyimpanan persisten (`navigator.storage`). */
export type PersistenceState =
	/** Belum diperiksa. */
	| 'unknown'
	/** `persisted() === true` — browser tidak akan mengusir data tanpa izin. */
	| 'persisted'
	/** Browser mendukung, tetapi belum/tidak memberi jaminan. */
	| 'best-effort'
	/** API tidak tersedia (mis. Safari lama, konteks tidak aman). */
	| 'unsupported'

export interface PlatformState {
	/** Shell memasang jembatan PWA (hanya shell web). */
	supported: boolean
	/** Berjalan sebagai aplikasi terpasang, bukan tab browser. */
	standalone: boolean
	/**
	 * Origin aman (HTTPS atau localhost). Service worker dan pemasangan HANYA
	 * tersedia di sini; di origin http biasa browser diam-diam menolaknya.
	 */
	secure: boolean
	installHint: InstallHint
	/** Service worker versi baru menunggu aktivasi. */
	updateAvailable: boolean
	persistence: PersistenceState
	/** Versi build (`__APP_VERSION__`). */
	version: string
}

export interface PlatformBridge {
	/** Snapshot stabil selama tidak ada perubahan (aman untuk `useSyncExternalStore`). */
	state: () => PlatformState
	subscribe: (listener: (state: PlatformState) => void) => () => void
	/** Tampilkan prompt pemasangan bawaan browser. `true` = user menerima. */
	requestInstall: () => Promise<boolean>
	/** Minta penyimpanan persisten. Hasilnya masuk ke `state().persistence`. */
	requestPersistence: () => Promise<void>
	/** Aktifkan SW baru dan muat ulang halaman. Hanya dari aksi eksplisit. */
	applyUpdate: () => void
}

/**
 * Snapshot untuk shell yang tidak mendukung PWA.
 *
 * Objek beku ini dipakai bersama supaya `state()` selalu mengembalikan
 * referensi yang sama (kalau tidak, `useSyncExternalStore` akan berputar).
 */
const DISABLED_STATE: PlatformState = Object.freeze({
	supported: false,
	standalone: false,
	secure: false,
	installHint: 'unsupported',
	updateAvailable: false,
	persistence: 'unsupported',
	version: '',
})

const DISABLED_BRIDGE: PlatformBridge = {
	state: () => DISABLED_STATE,
	subscribe: () => () => {},
	requestInstall: async () => false,
	requestPersistence: async () => {},
	applyUpdate: () => {},
}

let bridge: PlatformBridge | undefined

/** Pasang jembatan PWA dari shell. WAJIB sebelum render pertama. */
export const installPlatform = (value: PlatformBridge): void => {
	bridge = value
}

/** Buang jembatan (dipakai tes / hot-reload). */
export const resetPlatform = (): void => {
	bridge = undefined
}

/** Jembatan aktif — versi no-op bila shell tidak memasang apa pun. */
export const getPlatform = (): PlatformBridge => bridge ?? DISABLED_BRIDGE
