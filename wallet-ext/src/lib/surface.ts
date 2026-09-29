import { useState } from 'react'
import { traceWarn, withDeadline } from './trace'

/**
 * Deteksi apakah UI sedang berjalan di dalam POPUP extension.
 *
 * Kenapa perlu: satu bundel React melayani dua permukaan (popup 360x600 dan
 * tab penuh). Beberapa perilaku HARUS berbeda:
 *
 *   - Onboarding panjang & Riwayat penuh hanya nyaman di tab → popup
 *     menampilkan tombol "buka di tab" alih-alih form yang panjang.
 *   - `chrome.tabs.create` tidak tersedia dari halaman tab (tidak ada gunanya),
 *     jadi tombol itu disembunyikan di sana.
 *
 * PENTING — kenapa `require` sinkron dan BUKAN pesan ke service worker:
 * deteksi ini berjalan di jalur BOOT. `chrome.extension.getViews` sinkron dan
 * selalu tersedia di halaman extension, jadi popup bisa menggambar kerangka
 * UI-nya tanpa menunggu proses lain. Versi sebelumnya memanggil service
 * worker; bila SW belum aktif atau round-trip gagal, janji itu tidak pernah
 * selesai dan popup menggantung di splash tanpa batas.
 */
const isExtensionPopup = (): boolean => {
	if (typeof chrome === 'undefined') return false

	// Jalur utama: `getViews` sinkron, tidak butuh service worker.
	try {
		const views = chrome.extension?.getViews?.({ type: 'popup' })
		if (Array.isArray(views)) return views.length > 0
	} catch {
		// getViews bisa melempar bila dipanggil dari konteks tanpa izin.
	}

	// Jalur cadangan: popup Chrome selalu sempit; tab bisa di-resize.
	if (typeof window === 'undefined') return false
	return window.innerWidth <= 420
}

/**
 * `true` jika komponen dirender di popup extension.
 *
 * Bukan state reaktif: lebar popup tidak berubah selama hidupnya, jadi satu
 * pembacaan saat mount sudah benar dan menghindari re-render saat resize.
 */
export const useIsPopup = (): boolean => {
	const [isPopup] = useState(isExtensionPopup)
	return isPopup
}

/**
 * Buka `wallet.html` di tab extension penuh.
 *
 * Dua jalur karena popup dan tab berbagi komponen yang sama:
 *   - Dari popup  → minta service worker (`NEX_OPEN_WALLET`) supaya tab yang
 *                   sudah ada difokuskan, bukan ditumpuk.
 *   - Dari tab    → tidak ada yang perlu dibuka; pemanggil biasanya sudah
 *                   menyembunyikan tombolnya lewat `useIsPopup()`.
 *
 * @returns pesan error siap tampil, atau `undefined` bila berhasil.
 */
export const openWalletTab = async (): Promise<string | undefined> => {
	if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
		return 'Hanya tersedia di dalam extension.'
	}
	try {
		// Batas waktu keras: bila service worker tidak menjawab (mis. gagal
		// register, atau pesan hilang), tombol tidak boleh "menggantung" —
		// kembalikan pesan galat supaya pengguna tahu.
		const response = (await withDeadline(
			'service worker NEX_OPEN_WALLET',
			chrome.runtime.sendMessage({ type: 'NEX_OPEN_WALLET' }),
			5_000,
		)) as { ok?: boolean; error?: string } | undefined
		if (response?.ok) return undefined
		return response?.error ?? 'Gagal membuka tab wallet.'
	} catch (error) {
		traceWarn(
			'openWalletTab gagal',
			error instanceof Error ? error.message : String(error),
		)
		return error instanceof Error ? error.message : 'Gagal membuka tab wallet.'
	}
}
