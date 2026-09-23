import { Link } from 'react-router-dom'
import { rpc } from '../api/methods'
import { BlockTable } from '../components/BlockTable'
import { TxTable } from '../components/TxTable'
import { HashValue } from '../components/common/HashValue'
import { StatCard } from '../components/common/StatCard'
import { EmptyState, ErrorState, LoadingState } from '../components/common/States'
import { useAsync } from '../hooks/useAsync'
import { useChain } from '../hooks/useChainState'
import {
	formatDateTime,
	formatDuration,
	formatNxc,
	formatNumber,
	formatSize,
	timeAgo,
} from '../lib/format'

const MEMPOOL_PREVIEW = 8

export function DashboardPage() {
	const chain = useChain()

	const recent = useAsync(() => rpc.getRecentBlocks(10), [], { pollMs: 5000 })
	const mempool = useAsync(() => rpc.getMempool(), [], { pollMs: 8000 })

	if (!chain.state && chain.loading) return <LoadingState label="Connecting to chain…" />
	if (!chain.state && chain.error) {
		return <ErrorState error={chain.error} onRetry={chain.refresh} title="RPC unreachable" />
	}
	if (!chain.state) {
		return <ErrorState error={new Error('Chain state unavailable')} onRetry={chain.refresh} />
	}

	const state = chain.state
	const blocks = recent.data ?? []
	const latest = blocks[0]

	const avgBlockTime =
		blocks.length >= 2
			? (blocks[0].timestamp - blocks[blocks.length - 1].timestamp) /
				(blocks.length - 1)
			: undefined

	const pending = mempool.data ?? []

	return (
		<div className="page">
			<section className="stat-grid" aria-label="Chain statistics">
				<StatCard
					label="Block height"
					value={<Link className="link" to={`/block/${state.currentBlockHeight}`}>#{formatNumber(state.currentBlockHeight)}</Link>}
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
					value={avgBlockTime !== undefined ? formatDuration(avgBlockTime) : '—'}
					hint="last 10 blocks"
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

			<section className="card" aria-label="Latest block">
				<div className="card-head">
					<h2>Latest block</h2>
					{latest ? (
						<Link className="btn btn-ghost" to={`/block/${latest.height}`}>
							View details →
						</Link>
					) : null}
				</div>
				{recent.error && !latest ? (
					<ErrorState error={recent.error} onRetry={recent.refresh} />
				) : !latest ? (
					<LoadingState label="Loading recent blocks…" />
				) : (
					<dl className="kv-grid">
						<div className="kv">
							<dt>Hash</dt>
							<dd>
								<HashValue value={latest.hash} link={`/block/${latest.hash}`} head={14} tail={12} />
							</dd>
						</div>
						<div className="kv">
							<dt>Previous</dt>
							<dd>
								<HashValue value={latest.previousBlockHash} link={`/block/${latest.previousBlockHash}`} head={14} tail={12} />
							</dd>
						</div>
						<div className="kv">
							<dt>Timestamp</dt>
							<dd title={formatDateTime(latest.timestamp)}>
								{timeAgo(latest.timestamp)} · {formatDateTime(latest.timestamp)}
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
				)}
			</section>

			<section className="card" aria-label="Recent blocks">
				<div className="card-head">
					<h2>Recent blocks</h2>
					<Link className="btn btn-ghost" to="/blocks">
						All blocks →
					</Link>
				</div>
				{recent.error && !latest ? null : blocks.length > 0 ? (
					<BlockTable blocks={blocks} />
				) : (
					<LoadingState label="Loading blocks…" />
				)}
			</section>

			<section className="card" aria-label="Mempool">
				<div className="card-head">
					<h2>
						Mempool{' '}
						<span className="muted">
							({formatNumber(pending.length)} pending)
						</span>
					</h2>
				</div>
				{mempool.error && !mempool.data ? (
					<ErrorState error={mempool.error} onRetry={mempool.refresh} />
				) : pending.length > 0 ? (
					<>
						<TxTable transactions={pending.slice(0, MEMPOOL_PREVIEW)} />
						{pending.length > MEMPOOL_PREVIEW ? (
							<p className="muted pad-sm">
								Showing {MEMPOOL_PREVIEW} of {formatNumber(pending.length)}{' '}
								pending transactions.
							</p>
						) : null}
					</>
				) : (
					<EmptyState
						title="Mempool is empty"
						hint="No transactions are waiting to be mined."
					/>
				)}
			</section>
		</div>
	)
}
