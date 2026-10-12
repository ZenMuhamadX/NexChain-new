/**
 * Shell DEVELOPER — untuk mengerjakan tampilan dan alur wallet.
 *
 * Bukan aplikasi yang dikirim ke pengguna. Gunanya: menjalankan wallet tanpa
 * IndexedDB dan tanpa berkas vault, sehingga setiap kali mengubah desain tidak
 * perlu membuat wallet baru, mencatat mnemonic, dan unlock berulang.
 *
 * Vault memakai backend `memory` (`VITE_VAULT_BACKEND=memory`) — hilang saat
 * tab ditutup, dan itu memang yang diinginkan.
 *
 * Menyalakan:  bun run wallet:dev     (dari root repo)
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/polyfill'
import '../../src/style.css'
import { initRpcUrl } from '../../src/lib/rpcUrl'
import { App } from '../../src/App'
import { CryptoProgress } from '../../src/ui/CryptoProgress'

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
