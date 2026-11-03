import { useEffect, useRef } from 'react'

/**
 * Jalankan `run` SEKARANG lalu tiap `ms`, dan BERHENTI selama halaman tidak
 * terlihat; begitu kembali terlihat, `run` dijalankan lagi lebih dulu.
 *
 * Kenapa bukan `setInterval` biasa: di HP, timer halaman yang di-background
 * tetap (kadang) berjalan, dan setiap tick berarti beberapa request RPC —
 * membangunkan radio dan menguras baterai untuk angka yang tidak dilihat
 * siapa pun. Sekaligus menutup masalah kebalikannya: angka yang tampil setelah
 * aplikasi dibuka kembali tidak basi.
 *
 * `run` disimpan di ref, jadi pemanggil boleh memberi closure baru tiap render
 * tanpa memasang ulang timer.
 */
export const useVisibleInterval = (
	run: () => void,
	ms: number,
	enabled = true,
): void => {
	const runRef = useRef(run)
	runRef.current = run

	useEffect(() => {
		if (!enabled) return
		let timer: number | undefined

		const stop = (): void => {
			if (timer === undefined) return
			window.clearInterval(timer)
			timer = undefined
		}

		const start = (): void => {
			if (timer !== undefined) return
			runRef.current()
			timer = window.setInterval(() => runRef.current(), ms)
		}

		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'visible') start()
			else stop()
		}

		if (document.visibilityState === 'visible') start()
		document.addEventListener('visibilitychange', onVisibilityChange)

		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange)
			stop()
		}
	}, [ms, enabled])
}
