/**
 * Shell WEB (PWA) — satu-satunya shell yang dikirim ke perangkat pengguna.
 *
 * Tugasnya cuma menyusun: pasang backend vault IndexedDB, pasang jembatan
 * platform PWA, tentukan URL RPC, lalu render `App` yang sama dengan shell
 * desktop. Sembilan layar tidak tahu shell apa yang menjalankannya.
 *
 * Perbedaan dengan shell lain HANYA di titik suntik:
 *   - vault   : IndexedDB (disuntik eksplisit di bawah, lihat alasannya)
 *   - device  : heuristik (jangan dipaksa — HP memang perangkat lemah)
 *   - rpc     : localStorage → `VITE_RPC_URL` → origin halaman (`/rpc`)
 *   - platform: `installWebPlatform()` (install/update/persistensi)
 *
 * Menyalakan untuk uji PWA:  bun run wallet:build:web && bun run wallet:preview:web
 * (dev server sengaja TIDAK mendaftarkan service worker.)
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { WalletKV } from 'src/client/wallet/kv'
import { createIdbKV } from 'src/client/wallet/idbKv'
import '../../src/polyfill'
import '../../src/style.css'
import { installVaultKV } from '../../src/lib/vaultStore'
import { initRpcUrl } from '../../src/lib/rpcUrl'
import { installWebPlatform } from '../../src/pwa/register'
import { App } from '../../src/App'
import { CryptoProgress } from '../../src/ui/CryptoProgress'
import { PwaOverlay } from './PwaOverlay'

/**
 * Vault IndexedDB, dibuka sekali dan dipakai bersama.
 *
 * `createIdbKV()` mengembalikan Promise (membuka database), sedangkan
 * `installVaultKV()` menerima `WalletKV` secara sinkron. Adaptor ini
 * menjembatani keduanya tanpa membuat boot menunggu: promise-nya baru
 * ditunggu saat operasi pertama.
 *
 * KENAPA disuntik eksplisit, bukan dibiarkan memakai default `idb`:
 * `VITE_VAULT_BACKEND` bisa mengubah default itu (mis. `memory` yang bocor
 * dari sesi debugging). Di PWA, vault memori berarti wallet pengguna hilang
 * setiap tab ditutup — tanpa error, hanya "wallet tidak ada". Injeksi
 * eksplisit menutup jalur itu.
 */
let idb: Promise<WalletKV> | undefined
const openIdb = (): Promise<WalletKV> => (idb ??= createIdbKV())

const idbKV: WalletKV = {
	get: <T,>(key: string): Promise<T | undefined> =>
		openIdb().then((kv) => kv.get<T>(key)),
	set: <T,>(key: string, value: T): Promise<void> =>
		openIdb().then((kv) => kv.set<T>(key, value)),
	delete: (key: string): Promise<void> =>
		openIdb().then((kv) => kv.delete(key)),
}

// ── URUTAN PENTING ────────────────────────────────────────────────────────
// 1. Backend vault: `getVault()` menyimpan promise singleton, jadi backend
//    harus terpasang SEBELUM render pertama.
installVaultKV(idbKV, 'idb')
// 2. Platform PWA: mendaftarkan service worker + menangkap
//    `beforeinstallprompt`. Statusnya dibaca Settings dan banner update.
installWebPlatform()
// 3. URL RPC sebelum request pertama.
initRpcUrl()

const container = document.getElementById('root')
if (!container) throw new Error('Elemen #root tidak ditemukan di index.html')

createRoot(container).render(
	<StrictMode>
		<App />
		<CryptoProgress />
		<PwaOverlay />
	</StrictMode>,
)
