import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './polyfill' // wajib paling atas: global Buffer sebelum modul bip39
import './style.css'
import { initRpcUrl } from './lib/rpcUrl'
import { App } from './App'
import { CryptoProgress } from './ui/CryptoProgress'

// Override URL RPC dari localStorage dipasang SEBELUM request pertama (E4).
initRpcUrl()

const container = document.getElementById('root')
if (!container) throw new Error('Elemen #root tidak ditemukan di index.html')

createRoot(container).render(
	<StrictMode>
		<App />
		{/* Pill progres PBKDF2 — fixed, selalu dirender di luar App agar
		    tampil di semua layar (locked/unlocked) tanpa duplikasi. */}
		<CryptoProgress />
	</StrictMode>,
)
