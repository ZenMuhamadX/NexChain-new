import { createRoot } from 'react-dom/client'
// Wajib paling atas: global Buffer sebelum modul bip39/bip32 di-load.
import '../polyfill'
import '../style.css'
import { initRpcUrl } from '../lib/rpcUrl'
import { loadExplorerUrl } from '../lib/explorerUrl'
import { App } from '../App'
import { CryptoProgress } from '../ui/CryptoProgress'
import {
	probeChromeStorage,
	probeWorker,
	traceEnvironment,
	traceNote,
	traceStep,
	watch,
} from '../lib/trace'

/**
 * Entry point POPUP (MV3) — juga dipakai `wallet.html` (permukaan tab).
 *
 * Kenapa ada `renderFatal`: versi sebelumnya `void boot()` tanpa penangkap.
 * Bila boot melempar (mis. chrome.storage ditolak CSP, modul gagal di-parse),
 * janji itu ditolak tanpa jejak dan popup tampil KOSONG — persis gejala yang
 * paling sulit didiagnosis karena tidak ada pesan apa pun. Sekarang kegagalan
 * ditulis ke DOM supaya terlihat langsung di popup 360px.
 *
 * CATATAN DIAGNOSTIK: blok `jalankanDiagnostik()` di bawah bersifat SEMENTARA
 * untuk melacak penyebab "Penyimpanan tidak merespons". Hapus setelah selesai.
 */

const renderFatal = (container: HTMLElement | null, error: unknown): void => {
	const message =
		error instanceof Error
			? `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
			: String(error)

	if (container) {
		container.innerHTML = ''
	} else {
		document.body.innerHTML = ''
	}

	const pre = document.createElement('pre')
	pre.style.cssText =
		'position:fixed;inset:0;margin:0;padding:12px;overflow:auto;' +
		'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;' +
		'white-space:pre-wrap;color:#b91c1c;background:#fff;z-index:99999'
	pre.textContent = `Gagal memuat wallet.\n\n${message}`
	;(container ?? document.body).appendChild(pre)
	console.error('[NexChain] boot gagal:', error)
}

/**
 * DIAGNOSTIK SEMENTARA — jalankan sebelum React mount.
 *
 * Membuktikan secara berurutan apakah tiap lapisan responsif:
 *   1. chrome.storage.local (set/get/remove dengan timeout 3 dtk)
 *   2. Web Worker kripto (sinyal READY, timeout 8 dtk)
 *
 * Hasilnya dicatat ke console `[nex-boot]` DAN ke DOM (`#boot-diag`) supaya
 * tetap terbaca lewat `--dump-dom` / inspect walau console sulit dibuka.
 */
const jalankanDiagnostik = async (): Promise<void> => {
	traceEnvironment()

	const storage = await traceStep('probe chrome.storage.local', () =>
		probeChromeStorage(),
	)
	traceNote(`storage → ${storage}`)

	const worker = await traceStep('probe crypto Web Worker', () => probeWorker())
	traceNote(`worker → ${worker}`)

	const ringkasan = `storage: ${storage}\nworker: ${worker}`
	document.documentElement.dataset.nexDiag = ringkasan
	const marker = document.createElement('script')
	marker.id = 'boot-diag'
	marker.type = 'application/json'
	marker.textContent = JSON.stringify({ storage, worker })
	document.head.appendChild(marker)
}

const boot = async (): Promise<void> => {
	await traceStep('boot: initRpcUrl + loadExplorerUrl', () =>
		watch(
			'initRpcUrl/loadExplorerUrl',
			Promise.all([initRpcUrl(), loadExplorerUrl()]),
			5000,
		),
	)

	const container = document.getElementById('root')
	if (!container) throw new Error('Elemen #root tidak ditemukan di halaman.')

	traceNote('mount React')
	/**
	 * TANPA StrictMode — keputusan sadar.
	 *
	 * `StrictMode` sengaja me-mount, meng-unmount, lalu me-mount ulang setiap
	 * komponen untuk mendeteksi efek yang tidak bersih. Di extension ini itu
	 * berbahaya: efek boot di `App` memasang failsafe 15 detik, dan pass
	 * mount-1 bisa meninggalkan timer yang tetap menyala setelah unmount.
	 * Timer itu lalu memunculkan "Penyimpanan tidak merespons" padahal boot
	 * SUDAH selesai di pass mount-2.
	 *
	 * StrictMode adalah alat DEBUG (dev), bukan mode produksi. Extension ini
	 * tidak memakai double-invoke untuk apa pun, jadi menghapusnya
	 * menghilangkan seluruh kelas bug "galat palsu dari efek yang di-unmount".
	 */
	createRoot(container).render(
		<>
			<App />
			<CryptoProgress />
		</>,
	)
}

void (async () => {
	/**
	 * PENTING: diagnostik TIDAK di-`await`.
	 *
	 * Versi sebelumnya melakukan `await jalankanDiagnostik()` sebelum
	 * `boot()`. `jalankanDiagnostik` memanggil `probeWorker()` yang membuat
	 * Web Worker sungguhan untuk uji — dengan batas 8 detik. Artinya jalur
	 * diagnostik SENDIRI menunda React mount hingga 8 detik, dan bila ada
	 * beberapa uji, totalnya bisa melewati failsafe 15 detik.
	 *
	 * Blok diagnostik tidak boleh berada di jalur kritis boot: jalankan
	 * tanpa menunggu, biarkan hasilnya muncul di console belakangan.
	 */
	void jalankanDiagnostik().catch((error: unknown) => {
		console.warn('[nex-boot] diagnostik gagal:', error)
	})

	await boot()
})().catch((error: unknown) => {
	renderFatal(document.getElementById('root'), error)
})

