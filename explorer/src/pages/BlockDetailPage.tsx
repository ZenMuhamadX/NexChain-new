import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import { tryHexText } from '../api/decoder'
import type { BlockResponse } from '../api/types'
import { TxTable } from '../components/TxTable'
import { HashValue } from '../components/common/HashValue'
import { RawJson } from '../components/common/RawJson'
import { StatCard } from '../components/common/StatCard'
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from '../components/common/States'
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

const HASH = /^(0x)?[0-9a-fA-F]{64}$/

/**
 * Detail blok — menerima height (`/block/873`) ATAU hash
 * (`/block/000007cc…`), deteksi otomatis dari bentuk param.
 */
export function BlockDetailPage() {
	const { id = '' } = useParams()
	const chain = useChain()

	const byHeight = /^\d+$/.test(id)
	const byHash = HASH.test(id)
	const cleanHash = id.replace(/^0x/, '')

	const { data, error, loading, refresh } = useAsync<BlockResponse | undefined>(
		async () => {
			if (byHeight) return await rpc.getBlockByHeight(Number(id))
			if (byHash) return await rpc.getBlockByHash(cleanHash)
			return undefined
		},
		[id],
	)

	if (!byHeight && !byHash) {
		return (
			<div className="page">
				<EmptyState
					title="Invalid block reference"
					hint={
						<>
							<code>{id}</code> is neither a height nor a 64-char hash.
						</>
					}
					action={
						<Link className="btn btn-primary" to="/blocks">
							Browse blocks
						</Link>
					}
				/>
			</div>
		)
	}

	if (loading && !data) return <LoadingState label="Loading block…" />

	// Kasus height tidak ada: backend balas tanpa key `result` → undefined.
	// Kasus hash tidak ada: LevelDB throw → JSON-RPC error "…not found…".
	if (data === undefined && !error) {
		return (
			<div className="page">
				<EmptyState
					title="Block not found"
					hint={
						<>
							No block matches <code>{id}</code>.
						</>
					}
					action={
						<Link className="btn btn-primary" to="/blocks">
							Browse blocks
						</Link>
					}
				/>
			</div>
		)
	}
	if (error && isNotFound(error)) {
		return (
			<div className="page">
				<EmptyState
					title="Block not found"
					hint={
						<>
							No block matches <code>{id}</code>.
						</>
					}
					action={
						<Link className="btn btn-primary" to="/blocks">
							Browse blocks
						</Link>
					}
				/>
			</div>
		)
	}
	if (error && !data) {
		return <ErrorState error={error} onRetry={refresh} />
	}

	const block = data!.block
	const height = block.height
	const tip = chain.state?.currentBlockHeight
	const prevDisabled = height <= 0
	const nextDisabled = tip !== undefined && height >= tip
	const coinbaseText = tryHexText(block.coinbaseTransaction.extraData)
	const metaText = block.metadata ? tryHexText(block.metadata.extraData) : null

	return (
		<div className="page">
			<div className="page-head">
				<div>
					<h1>
						Block #{formatNumber(height)}{' '}
						<span className={`badge badge-${block.status}`}>
							{block.status}
						</span>
					</h1>
					<p className="muted">
						{formatDateTime(block.header.timestamp)} ·{' '}
						{timeAgo(block.header.timestamp)} · {formatSize(block.size)} ·{' '}
						{formatNumber(block.transactions.length)} tx
					</p>
				</div>
				<div className="detail-nav">
					<Link
						className={`btn${prevDisabled ? ' btn-disabled' : ''}`}
						to={`/block/${height - 1}`}
						onClick={(event) => (prevDisabled ? event.preventDefault() : undefined)}
						aria-disabled={prevDisabled}
					>
						← #{formatNumber(height - 1)}
					</Link>
					<Link
						className="btn"
						to={`/block/${height + 1}`}
						onClick={(event) => (nextDisabled ? event.preventDefault() : undefined)}
						aria-disabled={nextDisabled}
					>
						#{formatNumber(height + 1)} →
					</Link>
				</div>
			</div>

			<section className="stat-grid" aria-label="Block statistics">
				<StatCard
					label="Height"
					value={`#${formatNumber(height)}`}
					hint={tip !== undefined ? `tip #${formatNumber(tip)}` : undefined}
					accent
				/>
				<StatCard
					label="Transactions"
					value={formatNumber(block.transactions.length)}
					hint={
						block.metadata
							? `metadata txCount ${block.metadata.txCount}`
							: undefined
					}
				/>
				<StatCard label="Size" value={formatSize(block.size)} />
				<StatCard
					label="Difficulty"
					value={formatNumber(block.header.difficulty)}
					hint={block.header.hashingAlgorithm}
				/>
				<StatCard
					label="Block reward"
					value={formatNxc(block.blockReward, 4)}
					hint={`total ${formatNxc(block.totalReward, 4)}`}
				/>
				<StatCard
					label="Tx fees"
					value={`${formatNumber(block.totalTransactionFees)} nexu`}
				/>
			</section>

			<section className="card" aria-label="Block details">
				<h2>Overview</h2>
				<dl className="kv-grid" style={{ marginTop: '0.75rem' }}>
					<div className="kv kv-full">
						<dt>Hash</dt>
						<dd>
							<HashValue value={block.header.hash} head={18} tail={16} />
						</dd>
					</div>
					<div className="kv kv-full">
						<dt>Previous block hash</dt>
						<dd>
							<HashValue
								value={block.header.previousBlockHash}
								link={
									height > 0 ? `/block/${height - 1}` : `/block/${block.header.previousBlockHash}`
								}
								head={18}
								tail={16}
							/>
						</dd>
					</div>
					<div className="kv">
						<dt>Timestamp</dt>
						<dd title={formatDateTime(block.header.timestamp)}>
							{formatDateTime(block.header.timestamp)} ({timeAgo(block.header.timestamp)})
						</dd>
					</div>
					<div className="kv">
						<dt>Miner ID</dt>
						<dd className="mono">{block.minerId}</dd>
					</div>
					<div className="kv">
						<dt>Chain ID</dt>
						<dd>{block.chainId ?? chain.chainId ?? '—'}</dd>
					</div>
					<div className="kv">
						<dt>Version</dt>
						<dd>
							{block.header.version} · {block.header.hashingAlgorithm}
						</dd>
					</div>
					<div className="kv">
						<dt>Nonce</dt>
						<dd className="mono">{formatNumber(block.header.nonce)}</dd>
					</div>
					<div className="kv">
						<dt>Status</dt>
						<dd>
							<span className={`badge badge-${block.status}`}>{block.status}</span>
						</dd>
					</div>
					<div className="kv kv-full">
						<dt>Merkle root</dt>
						<dd>
							<HashValue value={block.merkleRoot} head={18} tail={16} />
						</dd>
					</div>
					<div className="kv kv-full">
						<dt>Coinbase → receiver</dt>
						<dd>
							<Link
								className="link mono"
								to={`/address/${block.coinbaseTransaction.receiver}`}
							>
								{block.coinbaseTransaction.receiver}
							</Link>
							<span className="muted">
								{formatNxc(block.coinbaseTransaction.amount, 6)}
								{coinbaseText ? ` · "${coinbaseText}"` : ''}
							</span>
						</dd>
					</div>
				</dl>
			</section>

			{block.metadata ? (
				<section className="card" aria-label="Metadata">
					<h2>Metadata</h2>
					<dl className="kv-grid" style={{ marginTop: '0.75rem' }}>
						<div className="kv">
							<dt>txCount</dt>
							<dd>{formatNumber(block.metadata.txCount)}</dd>
						</div>
						<div className="kv">
							<dt>Gas price</dt>
							<dd>{formatNumber(block.metadata.gasPrice)} nexu</dd>
						</div>
						<div className="kv">
							<dt>Created at</dt>
							<dd>{formatDateTime(block.metadata.created_at)}</dd>
						</div>
						<div className="kv">
							<dt>Extra data</dt>
							<dd>
								{metaText ? (
									`"${metaText}"`
								) : (
									<code>{block.metadata.extraData}</code>
								)}
							</dd>
						</div>
					</dl>
				</section>
			) : null}


			<section className="card" aria-label="Transactions">
				<div className="card-head">
					<h2>
						Transactions{' '}
						<span className="muted">({block.transactions.length})</span>
					</h2>
				</div>
				{block.transactions.length > 0 ? (
					<TxTable transactions={block.transactions} />
				) : (
					<EmptyState
						title="No transactions in this block"
						hint="Only the coinbase reward was recorded."
					/>
				)}
			</section>

			<section className="card" aria-label="Signature">
				<h2>Signature</h2>
				<dl className="kv-grid" style={{ marginTop: '0.75rem' }}>
					<div className="kv">
						<dt>v</dt>
						<dd className="mono">{block.sign.v}</dd>
					</div>
					<div className="kv kv-full">
						<dt>r</dt>
						<dd>
							<HashValue value={block.sign.r} head={24} tail={20} />
						</dd>
					</div>
					<div className="kv kv-full">
						<dt>s</dt>
						<dd>
							<HashValue value={block.sign.s} head={24} tail={20} />
						</dd>
					</div>
				</dl>
			</section>

			<RawJson data={data} summary="Raw block JSON" />
		</div>
	)
}
