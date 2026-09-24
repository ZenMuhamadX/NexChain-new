import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useChain } from '../../hooks/useChainState'
import { useScrollRestoration } from '../../hooks/useScrollRestoration'
import { SearchBar } from '../SearchBar'
import { ThemeToggle } from '../ThemeToggle'

export function ExplorerLayout() {
	const chain = useChain()
	const location = useLocation()
	const mainRef = useRef<HTMLElement>(null)
	const firstRender = useRef(true)

	useScrollRestoration()

	// `--header-h` adalah `top` sticky thead. Angka statis di CSS selalu
	// meleset karena tinggi header ikut berubah saat font web Roboto
	// termuat setelah paint — akibatnya baris tabel terselip di bawah
	// header. Ukur elemennya langsung (fallback statis tetap ada di CSS
	// untuk keadaan tanpa JS).
	useEffect(() => {
		const header = document.querySelector<HTMLElement>('.header')
		if (!header) return
		const root = document.documentElement
		const sync = () => {
			root.style.setProperty('--header-h', `${header.offsetHeight}px`)
		}
		sync()
		if (typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(sync)
		observer.observe(header)
		return () => observer.disconnect()
	}, [])

	// Pindahkan fokus ke konten utama tiap ganti rute. Tanpa ini user
	// keyboard tetap tertinggal di header setelah navigasi dan pembaca
	// layar tidak mengumumkan halaman baru. Yang dipantau hanya
	// `pathname`, supaya navigasi query (?page=2) tidak melempar fokus
	// keluar dari tombol Pager yang baru ditekan.
	useEffect(() => {
		if (firstRender.current) {
			firstRender.current = false
			return
		}
		mainRef.current?.focus({ preventScroll: true })
	}, [location.pathname])

	return (
		<div className="app">
			<a className="skip-link" href="#main-content">
				Skip to main content
			</a>

			<header className="header">
				<div className="header-row">
					<NavLink to="/" className="brand">
						<span className="brand-mark" aria-hidden="true">
							<svg
								width="22"
								height="22"
								viewBox="0 0 32 32"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinejoin="round"
							>
								<path d="M16 4l9.53 5.5v11L16 26l-9.53-5.5v-11z" />
								<circle cx="16" cy="15" r="3.2" />
							</svg>
						</span>
						NexChain <span className="brand-sub">Explorer</span>
					</NavLink>
					<nav className="nav" aria-label="Primary">
						<NavLink to="/" end>
							Dashboard
						</NavLink>
						<NavLink to="/blocks">Blocks</NavLink>
						<NavLink to="/mempool">Mempool</NavLink>
					</nav>
					<div className="header-search">
						<SearchBar />
					</div>
					<div
						className={`chain-pill${chain.error ? ' chain-pill-down' : ''}`}
						title={
							chain.error
								? 'RPC unreachable'
								: `Chain ${chain.chainId ?? '—'} · last updated height`
						}
					>
						<span className="chain-dot" aria-hidden="true" />
						{chain.state
							? `Node Connected`
							: chain.error
								? 'offline'
								: 'connecting…'}
					</div>
					<ThemeToggle />
				</div>
			</header>

			<main id="main-content" className="main" tabIndex={-1} ref={mainRef}>
				<Outlet />
			</main>

			<footer className="footer">
				<span>Read-only block explorer for NexChain</span>
				<span>Chain ID {chain.chainId ?? '—'}</span>
			</footer>
		</div>
	)
}
