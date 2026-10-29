import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { TimeDisplayProvider } from '../../hooks/useTimeDisplay'
import { useChain } from '../../hooks/useChainState'
import { useScrollRestoration } from '../../hooks/useScrollRestoration'
import { SearchBar } from '../SearchBar'
import { NodeStatus } from './NodeStatus'

export function ExplorerLayout() {
	const chain = useChain()
	const location = useLocation()
	const mainRef = useRef<HTMLElement>(null)
	const firstRender = useRef(true)
	const [mobileNavOpen, setMobileNavOpen] = useState(false)
	const isHome = location.pathname === '/'

	useScrollRestoration()

	// Pindahkan fokus ke konten utama setiap kali pathname berubah. Query
	// pagination tidak sengaja memicu focus agar tombol Pager tetap fokus.
	useEffect(() => {
		if (firstRender.current) {
			firstRender.current = false
			return
		}
		mainRef.current?.focus({ preventScroll: true })
	}, [location.pathname])

	useEffect(() => {
		setMobileNavOpen(false)
	}, [location.pathname])

	useEffect(() => {
		if (!mobileNavOpen) return
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setMobileNavOpen(false)
		}
		window.addEventListener('keydown', closeOnEscape)
		return () => window.removeEventListener('keydown', closeOnEscape)
	}, [mobileNavOpen])

	return (
		<TimeDisplayProvider>
			<div className="app">
				<a className="skip-link" href="#main-content">
					Skip to main content
				</a>

				<header className="header">
					<div className="navbar">
						<div className="navbar-inner">
							<NavLink
								to="/"
								className="brand"
								aria-label="NexChain Explorer home"
							>
								<span className="brand-mark" aria-hidden="true">
									<svg
										width="28"
										height="28"
										viewBox="0 0 32 32"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.1"
										strokeLinejoin="round"
									>
										<path d="M16 4l9.53 5.5v11L16 26l-9.53-5.5v-11z" />
										<circle cx="16" cy="15" r="3.2" />
									</svg>
								</span>
								<span className="brand-wordmark">
									<strong>NexChain</strong>
									<span>Explorer</span>
								</span>
							</NavLink>

							<nav
								id="primary-navigation"
								className={`nav${mobileNavOpen ? ' is-open' : ''}`}
								aria-label="Primary navigation"
							>
								<NavLink
									to="/"
									end
									className={({ isActive }) =>
										isActive ? 'active' : undefined
									}
								>
									Home
								</NavLink>
								<NavLink
									to="/blocks"
									className={({ isActive }) => {
										const classes = [isActive ? 'active' : '']
										if (location.pathname.startsWith('/block')) {
											classes.push('nav-section-active')
										}
										return classes.filter(Boolean).join(' ') || undefined
									}}
								>
									Blockchain
								</NavLink>
								<NavLink
									to="/mempool"
									className={({ isActive }) =>
										isActive ? 'active' : undefined
									}
								>
									Pending Transactions
								</NavLink>
								{!isHome ? (
									<div className="header-search">
										<SearchBar />
									</div>
								) : null}
							</nav>

							<div className="navbar-actions">
								<NodeStatus />
								<button
									type="button"
									className="mobile-nav-toggle"
									aria-label={
										mobileNavOpen ? 'Close navigation' : 'Open navigation'
									}
									aria-expanded={mobileNavOpen}
									aria-controls="primary-navigation"
									onClick={() => setMobileNavOpen((open) => !open)}
								>
									<span aria-hidden="true" />
									<span aria-hidden="true" />
									<span aria-hidden="true" />
								</button>
							</div>
						</div>
					</div>
				</header>

				<main id="main-content" className="main" tabIndex={-1} ref={mainRef}>
					<Outlet />
				</main>

				<footer className="footer">
					<div className="footer-inner">
						<div>
							<strong>NexChain Explorer</strong>
							<span>Read-only access to the NexChain blockchain.</span>
						</div>
						<p className="footer-meta">
							<span>NexChain Mainnet</span>
							<span className="footer-sep" aria-hidden="true">
								·
							</span>
							<span>Chain ID {chain.chainId ?? '—'}</span>
						</p>
					</div>
				</footer>
			</div>
		</TimeDisplayProvider>
	)
}
