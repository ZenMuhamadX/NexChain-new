import { Link } from 'react-router-dom'
import { rpc } from '../api/methods'
import { BlockTable } from '../components/BlockTable'
import { SearchBar } from '../components/SearchBar'
import { TxTable } from '../components/TxTable'
import { HashValue } from '../components/common/HashValue'
import {
	CardSkeleton,
	SkeletonLines,
	SkeletonTable,
} from '../components/common/Skeleton'
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from '../components/common/States'
import { useAsync } from '../hooks/useAsync'
import { useChain } from '../hooks/useChainState'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
	formatDateTime,
	formatDuration,
	formatNxc,
	formatNumber,
	formatSize,
	timeAgo,
} from '../lib/format'

const MEMPOOL_PREVIEW = 6
const RECENT_BLOCKS = 40
const TABLE_BLOCKS = 10
/** `nex_getMempool` dipotong 100 entri global — angka ini bukan total backlog. */
const MEMPOOL_RPC_LIMIT = 100

export function DashboardPage() {
	useDocumentTitle()
	const chain = useChain()

	// Satu request untuk statistik dan tabel blok terbaru.
	const recent = useAsync(() => rpc.getRecentBlocks(RECENT_BLOCKS), [], {
		pollMs: 5000,
	})
	const mempool = useAsync(() => rpc.getMempool(), [], { pollMs: 8000 })

	if (!chain.state && chain.loading) {
		return <LoadingState label="Connecting to NexChain…" />
	}
	if (!chain.state && chain.error) {
		return (
			<ErrorState
				error={chain.error}
				onRetry={chain.refresh}
				title="RPC unreachable"
			/>
		)
	}
	if (!chain.state) {
		return (
			<ErrorState
				error={new Error('Chain state unavailable')}
				onRetry={chain.refresh}
			/>
		)
	}

	const state = chain.state
	const blocks = recent.data ?? []
	const windowed = blocks.slice(0, TABLE_BLOCKS)
	const latest = windowed[0]
	const avgBlockTime =
		windowed.length >= 2
			? (windowed[0].timestamp - windowed[windowed.length - 1].timestamp) /
				(windowed.length - 1)
			: undefined
	const pending = mempool.data ?? []
	const pendingCapped = pending.length >= MEMPOOL_RPC_LIMIT

	return (
		<div className="page page-dashboard">
			<section className="explorer-hero" aria-labelledby="explorer-title">
				<div className="hero-network" aria-hidden="true" />
				<div className="hero-content">
					<div className="hero-badge">
						<span className="chain-dot" />
						Live NexChain network
					</div>
					<h1 id="explorer-title">The NexChain Blockchain Explorer</h1>
					<p>
						Search the NexChain blockchain, follow recent blocks, and inspect
						transactions and addresses in one place.
					</p>
					<SearchBar variant="hero" />
					<div className="hero-hints" aria-label="Supported search types">
						<span>Block height</span>
						<span>Block hash</span>
						<span>Transaction hash</span>
						<span>Wallet address</span>
					</div>
				</div>
			</section>

			<section
				className="panel network-panel"
				aria-labelledby="network-overview-title"
			>
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Network</p>
						<h2 id="network-overview-title">NexChain Network Overview</h2>
					</div>
					<span className="live-label">
						<span className="chain-dot" aria-hidden="true" />
						Live
					</span>
				</div>
				<dl className="network-summary">
					<div>
						<dt>Current block</dt>
						<dd>
							<Link to={`/block/${state.currentBlockHeight}`}>
								#{formatNumber(state.currentBlockHeight)}
							</Link>
						</dd>
						<span>{latest ? timeAgo(latest.timestamp) : 'latest'}</span>
					</div>
					<div>
						<dt>Chain ID</dt>
						<dd>{chain.chainId ?? '—'}</dd>
						<span>Main network</span>
					</div>
					<div>
						<dt>Avg. block time</dt>
						<dd>
							{avgBlockTime !== undefined ? formatDuration(avgBlockTime) : '—'}
						</dd>
						<span>Last {windowed.length || 10} blocks</span>
					</div>
					<div>
						<dt>Difficulty</dt>
						<dd>{latest ? formatNumber(latest.difficulty) : '—'}</dd>
						<span>SHA256 proof-of-work</span>
					</div>
					<div>
						<dt>Pending tx</dt>
						<dd>
							<Link to="/mempool">
								{formatNumber(pending.length)}
								{pendingCapped ? '+' : ''}
							</Link>
						</dd>
						<span>
							{mempool.loading
								? 'loading…'
								: pendingCapped
									? `RPC cap (${MEMPOOL_RPC_LIMIT})`
									: 'in mempool'}
						</span>
					</div>
					<div>
						<dt>Block reward</dt>
						<dd>{formatNxc(state.blockReward, 4)}</dd>
						<span>Size {formatSize(state.currentBlockSize)}</span>
					</div>
				</dl>
			</section>

			<section
				className="panel table-panel"
				aria-labelledby="latest-blocks-title"
			>
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Blockchain</p>
						<h2 id="latest-blocks-title">Latest Blocks</h2>
					</div>
					<Link className="panel-link" to="/blocks">
						View all blocks <span aria-hidden="true">→</span>
					</Link>
				</div>
				<div className="panel-body table-panel-body">
					{recent.loading && !recent.data ? (
						<div className="state-block" role="status" aria-live="polite">
							<span className="sr-only">Loading latest blocks…</span>
							<SkeletonTable rows={6} cols={6} />
						</div>
					) : recent.error && !recent.data ? (
						<ErrorState error={recent.error} onRetry={recent.refresh} />
					) : recent.data && windowed.length === 0 ? (
						<EmptyState
							title="No blocks available"
							hint="The node has not returned any recent blocks yet."
						/>
					) : (
						<BlockTable blocks={windowed} highlightNew />
					)}
				</div>
			</section>

			<div className="dashboard-lower">
				<section className="panel" aria-labelledby="latest-block-title">
					<div className="panel-head">
						<div>
							<p className="panel-eyebrow">Chain head</p>
							<h2 id="latest-block-title">Latest Block</h2>
						</div>
						{latest ? (
							<Link className="panel-link" to={`/block/${latest.height}`}>
								Block details <span aria-hidden="true">→</span>
							</Link>
						) : null}
					</div>
					<div className="panel-body">
						{latest ? (
							<dl className="detail-grid detail-grid-compact">
								<div className="detail-row detail-row-full">
									<dt>Hash</dt>
									<dd>
										<HashValue
											value={latest.hash}
											link={`/block/${latest.hash}`}
											head={13}
											tail={11}
										/>
									</dd>
								</div>
								<div className="detail-row">
									<dt>Height</dt>
									<dd>
										<Link to={`/block/${latest.height}`}>
											#{formatNumber(latest.height)}
										</Link>
									</dd>
								</div>
								<div className="detail-row">
									<dt>Transactions</dt>
									<dd>{formatNumber(latest.txCount)}</dd>
								</div>
								<div className="detail-row">
									<dt>Timestamp</dt>
									<dd title={formatDateTime(latest.timestamp)}>
										{formatDateTime(latest.timestamp)}
									</dd>
								</div>
								<div className="detail-row">
									<dt>Size</dt>
									<dd>{formatSize(latest.size)}</dd>
								</div>
								<div className="detail-row detail-row-full">
									<dt>Miner</dt>
									<dd className="mono">{latest.minerId}</dd>
								</div>
							</dl>
						) : recent.error ? (
							<ErrorState error={recent.error} onRetry={recent.refresh} />
						) : recent.data && !latest ? (
							<EmptyState
								title="No latest block"
								hint="The node has not returned a recent block yet."
							/>
						) : (
							<CardSkeleton label="Loading latest block details">
								<SkeletonLines />
							</CardSkeleton>
						)}
					</div>
				</section>

				<section className="panel" aria-labelledby="pending-transactions-title">
					<div className="panel-head">
						<div>
							<p className="panel-eyebrow">Mempool</p>
							<h2 id="pending-transactions-title">
								Pending Transactions{' '}
								<span className="heading-count">
									{formatNumber(pending.length)}
									{pendingCapped ? '+' : ''}
								</span>
							</h2>
						</div>
						<Link className="panel-link" to="/mempool">
							View mempool <span aria-hidden="true">→</span>
						</Link>
					</div>
					<div className="panel-body table-panel-body">
						{mempool.error && !mempool.data ? (
							<ErrorState error={mempool.error} onRetry={mempool.refresh} />
						) : pending.length > 0 ? (
							<TxTable
								transactions={pending.slice(0, MEMPOOL_PREVIEW)}
								compact
							/>
						) : (
							<EmptyState
								title="Mempool is empty"
								hint="No transactions are waiting to be mined."
								action={
									<Link className="btn" to="/mempool">
										Open mempool
									</Link>
								}
							/>
						)}
					</div>
				</section>
			</div>
		</div>
	)
}
