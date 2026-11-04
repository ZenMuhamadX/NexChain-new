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
 *   - rpc     : localStorage → `VITE_RPC_URL` → node publik default
 *   - platform: `installWebPlatform()` (install/update/persistensi)
 *
 * Menyalakan untuk uji PWA:  bun run wallet:build:web && bun run wallet:preview:web
 * (dev server sengaja TIDAK mendaftarkan service worker.)
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/polyfill'
import '../../src/style.css'
import { createIdbVaultKV, installVaultKV } from '../../src/lib/vaultStore'
import { initRpcUrl } from '../../src/lib/rpcUrl'
import { installWebPlatform } from '../../src/pwa/register'
import { App } from '../../src/App'
import { CryptoProgress } from '../../src/ui/CryptoProgress'
import { PwaOverlay } from './PwaOverlay'

// ── URUTAN PENTING ────────────────────────────────────────────────────────
// 1. Backend vault: `getVault()` menyimpan promise singleton, jadi backend
//    harus terpasang SEBELUM render pertama. Disuntik eksplisit, bukan
//    dibiarkan memakai default `idb`: `VITE_VAULT_BACKEND` yang bocor dari
//    sesi debugging (mis. `memory`) membuat wallet pengguna hilang setiap tab
//    ditutup — tanpa error, hanya "wallet tidak ada".
installVaultKV(createIdbVaultKV(), 'idb')
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
