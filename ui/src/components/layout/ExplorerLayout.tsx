import { NavLink, Outlet } from 'react-router-dom'
import type { ChainState } from '../../hooks/useChainState'
import { nexchainRpcUrl } from '../../config/env'

export function ExplorerLayout({ chain }: { chain: ChainState }) {
 return <main className="app-shell"><header className="topbar"><NavLink className="brand" to="/"><span className="mark">N</span><span>NexChain <em>Explorer</em></span></NavLink><nav aria-label="Explorer navigation"><NavLink to="/">Home</NavLink><NavLink to="/blocks">Blocks</NavLink></nav><div className={`connection ${chain.status}`}><i />{chain.status}</div></header><Outlet context={chain}/><footer><span>NexChain Explorer</span><code>{nexchainRpcUrl}</code></footer></main>
}
