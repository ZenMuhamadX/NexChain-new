/**
 * Shell DEVELOPER — untuk mengerjakan tampilan dan alur wallet.
 *
 * Bukan aplikasi yang dikirim ke pengguna. Gunanya: menjalankan wallet tanpa
 * IndexedDB dan tanpa berkas vault, sehingga setiap kali mengubah desain tidak
 * perlu membuat wallet baru, mencatat mnemonic, dan unlock berulang.
 *
 * Vault memakai backend `memory` — hilang saat tab ditutup, dan itu memang
 * yang diinginkan.
 *
 * Backend dipasang EKSPLISIT (bukan lewat `VITE_VAULT_BACKEND`): dev shell dan
 * preview PWA sama-sama memakai `localhost:5174`, jadi vault memori di sini
 * mencegah vault uji PWA (IndexedDB di origin yang sama) tercampur atau
 * terhapus tanpa sengaja.
 *
 * Menyalakan:  bun run wallet:dev     (dari root repo)
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryKV } from 'src/client/wallet/kv'
import '../../src/polyfill'
import '../../src/style.css'
import { installVaultKV } from '../../src/lib/vaultStore'
import { initRpcUrl } from '../../src/lib/rpcUrl'
import { App } from '../../src/App'
import { CryptoProgress } from '../../src/ui/CryptoProgress'

// Vault memori sebelum render: `getVault()` menyimpan promise singleton.
installVaultKV(createMemoryKV(), 'memory')

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
