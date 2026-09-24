import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Scroll restoration manual.
 *
 * React Router hanya menyediakan `<ScrollRestoration>` untuk data router;
 * aplikasi ini memakai `BrowserRouter`, jadi posisi scroll disimpan sendiri
 * per `location.key` di sessionStorage. Tanpa ini, kembali dari detail blok
 * ke `/blocks?page=3` selalu melempar user ke atas halaman.
 *
 * Hanya POP (tombol back/forward) yang me-restore; navigasi maju selalu
 * mulai dari atas.
 */
const STORE_KEY = 'nex:scroll'
const store = new Map<string, number>()

try {
	const raw = sessionStorage.getItem(STORE_KEY)
	if (raw) {
		for (const [key, value] of Object.entries(
			JSON.parse(raw) as Record<string, number>,
		)) {
			store.set(key, value)
		}
	}
} catch {
	// sessionStorage diblokir (private mode) — fitur ini non-kritis.
}

const persist = () => {
	try {
		sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(store)))
	} catch {
		// abaikan
	}
}

export function useScrollRestoration(): void {
	const location = useLocation()
	const navigationType = useNavigationType()
	const isFirst = useRef(true)

	// simpan posisi scroll lokasi yang sedang ditinggalkan
	useEffect(() => {
		return () => {
			store.set(location.key, window.scrollY)
			persist()
		}
	}, [location.key])

	// pulihkan (POP) atau reset (PUSH)
	useEffect(() => {
		if (isFirst.current) {
			isFirst.current = false
			return
		}
		if (navigationType === 'POP') {
			const saved = store.get(location.key)
			window.scrollTo(0, saved ?? 0)
		} else {
			window.scrollTo(0, 0)
		}
	}, [location.key, navigationType])
}
