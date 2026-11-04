/**
 * Shell DEVELOPER — untuk mengerjakan tampilan dan alur wallet.
 *
 * Bukan aplikasi yang dikirim ke pengguna. Vault memakai **IndexedDB yang sama
 * dengan PWA** (`createIdbVaultKV()`), jadi refresh (Ctrl+R) tidak menghapus
 * wallet dan tidak perlu menempel mnemonic berulang. Dev shell dan preview PWA
 * memang berjalan di origin yang sama (`localhost:5174`), sehingga keduanya
 * berbagi satu vault — untuk mulai bersih, pakai "Hapus wallet" di Pengaturan.
 *
 * Backend dipasang EKSPLISIT (bukan lewat `VITE_VAULT_BACKEND`) supaya env
 * yang tertinggal dari sesi debugging tidak diam-diam mengganti media
 * penyimpanan.
 *
 * Menyalakan:  bun run wallet:dev     (dari root repo)
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/polyfill'
import '../../src/style.css'
import { createIdbVaultKV, installVaultKV } from '../../src/lib/vaultStore'
import { initRpcUrl } from '../../src/lib/rpcUrl'
import { App } from '../../src/App'
import { CryptoProgress } from '../../src/ui/CryptoProgress'

// Vault IndexedDB sebelum render: `getVault()` menyimpan promise singleton.
installVaultKV(createIdbVaultKV(), 'idb')

// URL RPC dari localStorage dipasang SEBELUM request pertama.
initRpcUrl()

const container = document.getElementById('root')
if (!container) throw new Error('Elemen #root tidak ditemukan di index.html')

createRoot(container).render(
	<StrictMode>
		<App />
		<CryptoProgress />
	</StrictMode>,
)
