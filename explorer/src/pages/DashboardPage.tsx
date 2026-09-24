import { Link } from 'react-router-dom'
import { rpc } from '../api/methods'
import { TxTable } from '../components/TxTable'
import { HashValue } from '../components/common/HashValue'
import { StatCard } from '../components/common/StatCard'
import { CardSkeleton, SkeletonLines } from '../components/common/Skeleton'
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

const MEMPOOL_PREVIEW = 8
const GRID_BLOCKS = 40
const TABLE_BLOCKS = 10

export function DashboardPage() {
	useDocumentTitle()
	const chain = useChain()

	// satu request untuk grid (40) dan tabel (10 terbaru)
	const recent = useAsync(() => rpc.getRecentBlocks(GRID_BLOCKS), [], {
		pollMs: 5000,
	})
	const mempool = useAsync(() => rpc.getMempool(), [], { pollMs: 8000 })
	if (!chain.state && chain.loading)
		return <LoadingState label="Connecting to node…" />
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

	return (
		<div className="page">
			<div className="page-head">
				<div>
					<h1>NexChain dashboard</h1>
					<p className="muted">
						Tip #{formatNumber(state.currentBlockHeight)} · Chain ID{' '}
						{chain.chainId ?? '—'} · updates every few seconds
					</p>
				</div>
			</div>

			<section className="stat-grid" aria-label="Chain statistics">
				<StatCard
					label="Block height"
					value={
						<Link className="link" to={`/block/${state.currentBlockHeight}`}>
							#{formatNumber(state.currentBlockHeight)}
						</Link>
					}
					hint={latest ? timeAgo(latest.timestamp) : 'latest'}
					accent
				/>
				<StatCard label="Chain ID" value={String(chain.chainId ?? '—')} />
				<StatCard
					label="Difficulty"
					value={latest ? formatNumber(latest.difficulty) : '—'}
					hint="SHA256 proof-of-work"
				/>
				<StatCard
					label="Avg block time"
					value={
						avgBlockTime !== undefined ? formatDuration(avgBlockTime) : '—'
					}
					hint={`last ${windowed.length} blocks`}
				/>
				<StatCard
					label="Mempool"
					value={formatNumber(pending.length)}
					hint={mempool.loading ? 'loading…' : 'pending transactions'}
				/>
				<StatCard
					label="Block reward"
					value={formatNxc(state.blockReward, 4)}
					hint={`size ${formatSize(state.currentBlockSize)}`}
				/>
			</section>

			{/* Grid 2 kolom ala Etherscan: Latest block (detail) | Mempool */}
			<div className="dash-cols">
				{latest ? (
					<section className="card" aria-label="Latest block details">
						<div className="card-head">
							<h2>Latest block</h2>
							<Link className="btn btn-ghost" to={`/block/${latest.height}`}>
								View details →
							</Link>
						</div>
						<dl className="kv-grid">
							<div className="kv">
								<dt>Hash</dt>
								<dd>
									<HashValue
										value={latest.hash}
										link={`/block/${latest.hash}`}
										head={14}
										tail={12}
									/>
								</dd>
							</div>
							<div className="kv">
								<dt>Previous</dt>
								<dd>
									<HashValue
										value={latest.previousBlockHash}
										link={`/block/${latest.previousBlockHash}`}
										head={14}
										tail={12}
									/>
								</dd>
							</div>
							<div className="kv">
								<dt>Timestamp</dt>
								<dd title={formatDateTime(latest.timestamp)}>
									{timeAgo(latest.timestamp)} ·{' '}
									{formatDateTime(latest.timestamp)}
								</dd>
							</div>
							<div className="kv">
								<dt>Miner</dt>
								<dd className="mono">{latest.minerId}</dd>
							</div>
							<div className="kv">
								<dt>Transactions</dt>
								<dd>{formatNumber(latest.txCount)}</dd>
							</div>
							<div className="kv">
								<dt>Size</dt>
								<dd>{formatSize(latest.size)}</dd>
							</div>
						</dl>
					</section>
				) : recent.error && !blocks.length ? (
					<section className="card" aria-label="Loading latest block">
						<div className="card-head">
							<h2>Latest block</h2>
						</div>
						<ErrorState error={recent.error} onRetry={recent.refresh} />
					</section>
				) : (
					<section className="card" aria-label="Loading latest block">
						<div className="card-head">
							<h2>Latest block</h2>
						</div>
						<CardSkeleton label="Loading latest block details">
							<SkeletonLines />
						</CardSkeleton>
					</section>
				)}

				<section className="card" aria-label="Mempool">
					<div className="card-head">
						<h2>
							Mempool{' '}
							<span className="muted">
								({formatNumber(pending.length)} pending)
							</span>
						</h2>
						<Link className="btn btn-ghost" to="/mempool">
							View all →
						</Link>
					</div>
					{mempool.error && !mempool.data ? (
						<ErrorState error={mempool.error} onRetry={mempool.refresh} />
					) : pending.length > 0 ? (
						<>
							<TxTable transactions={pending.slice(0, MEMPOOL_PREVIEW)} />
							{pending.length > MEMPOOL_PREVIEW ? (
								<p className="muted pad-sm">
									Showing {MEMPOOL_PREVIEW} of {formatNumber(pending.length)}{' '}
									pending transactions · <Link to="/mempool">see all</Link>
								</p>
							) : null}
						</>
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
				</section>
			</div>
		</div>
	)
}
