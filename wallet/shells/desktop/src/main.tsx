/**
 * Shell DESKTOP (Electron) — renderer.
 *
 * Tugasnya hanya tiga: memasang backend berkas, memaksa kelas perangkat, lalu
 * merender `App` dari basis kode bersama `../../../src/`. Sembilan layar wallet
 * TIDAK diubah sedikit pun — mereka tidak tahu shell apa yang menjalankannya.
 *
 * ── Kontrak jembatan ──────────────────────────────────────────────────────
 * Proses utama Electron (`electron/main.cjs`) menyediakan operasi vault lewat
 * IPC, dan `electron/preload.cjs` mengeksposnya sebagai `window.nexVaultBridge`
 * SEBELUM bundle ini dimuat:
 *
 *     interface NexVaultBridge {
 *       read(key: string): Promise<string | undefined>
 *       write(key: string, value: string): Promise<void>
 *       remove(key: string): Promise<void>
 *       dataDir(): Promise<string>
 *     }
 *
 * Nilainya adalah JSON hasil `JSON.stringify(VaultRecord)` — jadi berkas
 * vault menyimpan blob terenkripsi, BUKAN mnemonic mentah.
 *
 * Lokasi berkas ditentukan PROSES UTAMA, bukan renderer:
 *     Windows : %APPDATA%\NexChain Wallet\wallet\<key>.json
 *     macOS   : ~/Library/Application Support/NexChain Wallet/wallet/<key>.json
 *     Linux   : ~/.config/NexChain Wallet/wallet/<key>.json
 *
 * WAJIB: jangan pernah menaruh berkas vault di sebelah executable. Direktori
 * program bersifat read-only di Windows dan bisa ikut terhapus saat update.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { WalletKV } from 'src/client/wallet/kv'
import '../../../src/polyfill'
import '../../../src/style.css'
import { installVaultKV } from '../../../src/lib/vaultStore'
import { installDeviceClass } from '../../../src/lib/deviceCrypto'
import { initRpcUrl } from '../../../src/lib/rpcUrl'
import { App } from '../../../src/App'
import { CryptoProgress } from '../../../src/ui/CryptoProgress'

/** Jembatan yang disediakan preload/proses utama. */
interface NexVaultBridge {
	read(key: string): Promise<string | undefined>
	write(key: string, value: string): Promise<void>
	remove(key: string): Promise<void>
	dataDir?(): Promise<string>
}

declare global {
	interface Window {
		nexVaultBridge?: NexVaultBridge
	}
}

/**
 * Adaptor `WalletKV` → berkas. Nilai diserialkan sebagai JSON karena vault
 * menyimpan struct (`VaultRecord`), bukan string.
 */
const createFileKV = (bridge: NexVaultBridge): WalletKV => ({
	get: async <T,>(key: string): Promise<T | undefined> => {
		const raw = await bridge.read(key)
		if (raw === undefined || raw === '') return undefined
		try {
			return JSON.parse(raw) as T
		} catch {
			// Berkas rusak diperlakukan sebagai "tidak ada" — caller akan
			// memunculkan layar setup, bukan macet di boot.
			return undefined
		}
	},
	set: async <T,>(key: string, value: T): Promise<void> => {
		await bridge.write(key, JSON.stringify(value))
	},
	delete: async (key: string): Promise<void> => {
		await bridge.remove(key)
	},
})

const bridge = window.nexVaultBridge
if (!bridge) {
	throw new Error(
		'Jembatan vault desktop tidak tersedia. Shell desktop harus memasang ' +
			'window.nexVaultBridge sebelum bundle ini dimuat.',
	)
}

// ── URUTAN PENTING ────────────────────────────────────────────────────────
// 1. Backend vault: `getVault()` menyimpan promise singleton, jadi backend
//    harus terpasang SEBELUM render pertama.
installVaultKV(createFileKV(bridge))
// 2. Kelas perangkat: PASTI desktop, jangan ditebak dari maxTouchPoints.
//    Tanpa ini, laptop layar sentuh turun ke PBKDF2 100k tanpa peringatan.
installDeviceClass('desktop')
// 3. URL RPC sebelum request pertama.
initRpcUrl()

const container = document.getElementById('root')
if (!container) throw new Error('Elemen #root tidak ditemukan di index.html')

createRoot(container).render(
	<StrictMode>
		<App />
		<CryptoProgress />
	</StrictMode>,
)
