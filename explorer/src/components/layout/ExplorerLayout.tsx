import { NavLink, Outlet } from 'react-router-dom'
import { useChain } from '../../hooks/useChainState'
import { formatNumber } from '../../lib/format'
import { RPC_URL } from '../../config/env'
import { SearchBar } from '../SearchBar'

export function ExplorerLayout() {
	const chain = useChain()

	return (
		<div className="app">
			<header className="header">
				<div className="header-row">
					<NavLink to="/" className="brand">
						<span className="brand-mark" aria-hidden="true">
							◈
						</span>
						NexChain <span className="brand-sub">Explorer</span>
					</NavLink>
					<nav className="nav" aria-label="Primary">
						<NavLink to="/" end>
							Dashboard
						</NavLink>
						<NavLink to="/blocks">Blocks</NavLink>
					</nav>
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
							? `#${formatNumber(chain.state.currentBlockHeight)}`
							: chain.error
								? 'offline'
								: 'connecting…'}
					</div>
				</div>
				<div className="header-row header-row-search">
					<SearchBar />
				</div>
			</header>

			<main className="main">
				<Outlet />
			</main>

			<footer className="footer">
				<span>
					Read-only explorer · RPC: <code>{RPC_URL}</code>
				</span>
				<span>Chain ID {chain.chainId ?? '—'}</span>
			</footer>
		</div>
	)
}
