import { useEffect, useState } from 'react'

const KEY = 'nex:theme'

type Theme = 'light' | 'dark'

/** Baca preferensi: localStorage dulu, lalu preferensi sistem. */
export function readTheme(): Theme {
	try {
		const saved = localStorage.getItem(KEY)
		if (saved === 'light' || saved === 'dark') return saved
	} catch {
		// localStorage diblokir — jatuh ke preferensi sistem
	}
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light'
}

export function applyTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme
}

/**
 * Toggle tema terang/gelap. Nilai awal diambil dari `data-theme` yang sudah
 * dipasang inline di index.html (sebelum paint) supaya tidak ada kilatan
 * terang saat user memilih tema gelap.
 */
export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => {
		const current = document.documentElement.dataset.theme
		return current === 'dark' || current === 'light' ? current : readTheme()
	})

	useEffect(() => {
		applyTheme(theme)
		try {
			localStorage.setItem(KEY, theme)
		} catch {
			// abaikan
		}
	}, [theme])

	const next: Theme = theme === 'dark' ? 'light' : 'dark'

	return (
		<button
			type="button"
			className="icon-btn theme-toggle"
			onClick={() => setTheme(next)}
			aria-label={`Switch to ${next} theme`}
			title={`Switch to ${next} theme`}
		>
			{theme === 'dark' ? (
				// Sun — ubah ke tema terang
				<svg
					aria-hidden="true"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
				>
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
				</svg>
			) : (
				// Moon — ubah ke tema gelap
				<svg
					aria-hidden="true"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
				</svg>
			)}
		</button>
	)
}
