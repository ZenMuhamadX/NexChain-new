/**
 * Tema tampilan: terang, gelap, atau mengikuti sistem.
 *
 * Nilai yang dipasang di `<html data-theme>` hanya `light`/`dark` — token CSS
 * memakai nama itu (`:root[data-theme='dark']`), sedangkan preferensi
 * pengguna disimpan sebagai `terang|gelap|sistem`.
 */
export type Theme = 'terang' | 'gelap' | 'sistem'

const STORAGE_KEY = 'nex_theme'

const prefersDark = (): boolean =>
	typeof window !== 'undefined' &&
	window.matchMedia('(prefers-color-scheme: dark)').matches

const apply = (theme: Theme): void => {
	if (typeof document === 'undefined') return
	const dark = theme === 'gelap' || (theme === 'sistem' && prefersDark())
	document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export const getTheme = (): Theme => {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		return raw === 'gelap' || raw === 'sistem' ? raw : 'terang'
	} catch {
		return 'terang'
	}
}

export const setTheme = (theme: Theme): void => {
	try {
		localStorage.setItem(STORAGE_KEY, theme)
	} catch {
		// localStorage diblokir → tema berlaku untuk sesi ini saja.
	}
	apply(theme)
}

/**
 * Dipasang sekali saat modul App dimuat: terapkan tema tersimpan sebelum
 * render pertama, lalu ikuti perubahan tema sistem bila pilihannya "sistem".
 */
export const installTheme = (): void => {
	if (typeof window === 'undefined') return
	apply(getTheme())
	window
		.matchMedia('(prefers-color-scheme: dark)')
		.addEventListener('change', () => apply(getTheme()))
}
