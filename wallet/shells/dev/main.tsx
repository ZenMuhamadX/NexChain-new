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

/**
 * Buang service worker sisa build PWA.
 *
 * Dev shell dan `vite preview --mode web` memakai origin yang sama
 * (`localhost:5174`). Kalau PWA pernah di-preview di sini, SW-nya tetap
 * terdaftar dan terus menyajikan `/index.html` dari cache produksi — akibatnya
 * dev server tampak "tidak ter-update" padahal HMR sehat, dan hard refresh
 * berakhir di 404.
 *
 * Dev server sudah menyajikan `/sw.js` bunuh diri (lihat `vite.config.ts`),
 * tapi itu baru berlaku setelah browser memeriksa ulang SW. Pemeriksaan ini
 * menutup celah tersebut untuk halaman yang HTML-nya datang dari jaringan.
 *
 * Cache Storage yang dihapus di sini BUKAN vault: vault ada di IndexedDB.
 */
const dropStaleServiceWorker = (): void => {
	if (!('serviceWorker' in navigator)) return

	const GUARD_KEY = 'nex_dev_sw_cleared'
	try {
		// Sekali per tab: kalau pemuatan ulang masih dikendalikan SW (kasus
		// langka), jangan sampai berputar tanpa henti.
		if (sessionStorage.getItem(GUARD_KEY) === '1') return
	} catch {
		// sessionStorage diblokir → lanjut tanpa penjaga; risiko loop kecil.
	}

	void (async () => {
		try {
			const registrations = await navigator.serviceWorker.getRegistrations()
			if (registrations.length === 0) return
			await Promise.all(registrations.map((entry) => entry.unregister()))
			const keys = await caches.keys()
			await Promise.all(keys.map((key) => caches.delete(key)))
			try {
				sessionStorage.setItem(GUARD_KEY, '1')
			} catch {
				// diabaikan
			}
			location.reload()
		} catch {
			// Dev shell tetap harus bisa dirender walau pembersihan gagal.
		}
	})()
}

dropStaleServiceWorker()

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
