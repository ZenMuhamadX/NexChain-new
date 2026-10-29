import { useEffect, useRef } from 'react'

/**
 * Auto-lock: kunci vault setelah aplikasi ditinggal lebih dari 5 menit.
 *
 * Kenapa lewat `visibilitychange`, bukan timer yang terus berjalan: di HP,
 * timer `setInterval` DITAHAN saat aplikasi di background (dan sering dibekukan
 * total oleh iOS). Timer 5 menit karena itu bisa baru menembak berjam-jam
 * kemudian, atau tidak sama sekali. Yang benar-benar bisa diandalkan adalah
 * membandingkan jam dinding saat aplikasi kembali terlihat.
 *
 * Konsekuensi yang diterima: wallet tetap terbuka di memori selama aplikasi
 * di background (itu tidak bisa dihindari tanpa menyimpan kunci). Kalau sistem
 * membunuh prosesnya, state hilang dan aplikasi kembali ke layar buka kunci.
 */
export const AUTO_LOCK_MS = 5 * 60_000

export const useAutoLock = (onLock: () => void, enabled: boolean): void => {
	/**
	 * Callback disimpan di ref supaya efek tidak dipasang ulang setiap render
	 * (handler `onLock` di App dibuat ulang tiap render, dan memasang ulang
	 * listener akan menghapus catatan waktu tersembunyi).
	 */
	const lockRef = useRef(onLock)
	lockRef.current = onLock

	useEffect(() => {
		if (!enabled) return

		/** Epoch-ms saat aplikasi disembunyikan; 0 = sedang terlihat. */
		let hiddenAt = 0

		const markHidden = (): void => {
			if (hiddenAt === 0) hiddenAt = Date.now()
		}

		const lockIfStale = (): void => {
			if (hiddenAt === 0) return
			const away = Date.now() - hiddenAt
			hiddenAt = 0
			if (away >= AUTO_LOCK_MS) lockRef.current()
		}

		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'hidden') markHidden()
			else lockIfStale()
		}

		/**
		 * `pagehide` menangkap kasus yang tidak memicu `visibilitychange`
		 * (navigasi keluar, aplikasi ditutup). Saat halaman di-restore dari
		 * bfcache, `pageshow` yang memutuskan.
		 */
		const onPageHide = (): void => markHidden()
		const onPageShow = (): void => lockIfStale()

		document.addEventListener('visibilitychange', onVisibilityChange)
		window.addEventListener('pagehide', onPageHide)
		window.addEventListener('pageshow', onPageShow)

		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange)
			window.removeEventListener('pagehide', onPageHide)
			window.removeEventListener('pageshow', onPageShow)
		}
	}, [enabled])
}
