import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import { tryHexText } from '../api/decoder'
import type { BlockResponse } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { TxTable } from '../components/TxTable'
import { HashValue } from '../components/common/HashValue'
import { RawJson } from '../components/common/RawJson'
import { StatCard } from '../components/common/StatCard'
import { PageSkeleton } from '../components/common/Skeleton'
import { EmptyState, ErrorState } from '../components/common/States'
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

const HASH = /^(0x)?[0-9a-fA-F]{64}$/
const TX_PAGE = 50
/** Skala meter konfirmasi (visual saja — tidak mengklaim aturan finalitas). */
const CONFIRMATION_SCALE = 12

/**
 * Detail blok — menerima height (`/block/873`) ATAU hash
 * (`/block/000007cc…`), deteksi otomatis dari bentuk param.
 *
 * Fase 2B (visual): hero rantai + meter pengganti dua tombol ←/→ polos,
 * supaya "di mana blok ini dan seberapa matang" terjawab tanpa scroll.
 */
export function BlockDetailPage() {
	const { id = '' } = useParams()
	const chain = useChain()
	const [shownTxs, setShownTxs] = useState(TX_PAGE)

	const byHeight = /^\d+$/.test(id)
	const byHash = HASH.test(id)
	const cleanHash = id.replace(/^0x/, '')

	const { data, error, loading, refresh } = useAsync<BlockResponse | undefined>(
		async () => {
			if (byHeight) return await rpc.getBlockByHeight(Number(id))
			if (byHash) return rpc.getBlockByHash(cleanHash)
			return undefined
		},
		[id],
	)

	// tujuh blok di sekitar height ini — untuk chain strip & skala meter
	const heightParam = byHeight ? Number(id) : undefined
	const tip = chain.state?.currentBlockHeight
	const neighbors = useAsync(
		() =>
			rpc.getBlocksRange(
				Math.min((heightParam ?? 0) + 3, tip ?? 0),
				7,
			),
		[heightParam, tip],
		{ enabled: heightParam !== undefined && tip !== undefined },
	)

	const height = data?.block.height
	useDocumentTitle(
		height !== undefined
			? `Block #${formatNumber(height)}`
			: byHeight
				? `Block ${id}`
				: 'Block',
	)

	useEffect(() => {
		setShownTxs(TX_PAGE)
	}, [id])

	const invalid = !byHeight && !byHash

	if (invalid) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Blocks', to: '/blocks' }, { label: 'Invalid' }]} />
				<EmptyState
					titleAs="h1"
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

	if (loading && !data) {
		return (
			<div className="page">
				<Breadcrumbs
					items={[{ label: 'Blocks', to: '/blocks' }, { label: id }]}
				/>
				<PageSkeleton label="Loading block…" />
			</div>
		)
	}

	// Kasus height tidak ada: backend balas tanpa key `result` → undefined.
	// Kasus hash tidak ada: LevelDB throw → JSON-RPC error "…not found…".
	if ((data === undefined && !error) || (error && isNotFound(error))) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Blocks', to: '/blocks' }, { label: id }]} />
				<EmptyState
					titleAs="h1"
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
	const currentHeight = block.height
	const prevDisabled = currentHeight <= 0
	const nextDisabled = tip !== undefined && currentHeight >= tip
	const coinbaseText = tryHexText(block.coinbaseTransaction.extraData)
	const metaText = block.metadata ? tryHexText(block.metadata.extraData) : null

	// --- data untuk strip & meter ---
	const strip = (neighbors.data ?? [])
		.filter(
			(candidate) =>
				candidate.height >= currentHeight - 3 &&
				candidate.height <= currentHeight + 3,
		)
		.sort((a, b) => a.height - b.height)

	const myTx = block.transactions.length
	const peakTx = strip.reduce((peak, b) => Math.max(peak, b.txCount), myTx)
	const densityPct = peakTx > 0 ? Math.round((myTx / peakTx) * 100) : 0

	const peakSize = strip.reduce((peak, b) => Math.max(peak, b.size), block.size)
	const sizePct = peakSize > 0 ? Math.round((block.size / peakSize) * 100) : 0

	const confirmations =
		tip !== undefined ? Math.max(tip - currentHeight + 1, 1) : undefined
	const confirmationPct =
		confirmations !== undefined
			? Math.min(100, Math.round((confirmations / CONFIRMATION_SCALE) * 100))
			: 0

	const visibleTxs = block.transactions.slice(0, shownTxs)
	const txHidden = block.transactions.length - visibleTxs.length

	return (
		<div className="page">
			<Breadcrumbs
				items={[
					{ label: 'Blocks', to: '/blocks' },
					{ label: `#${formatNumber(currentHeight)}` },
				]}
			/>

			{/* --- hero: posisi dalam rantai, terbaca tanpa scroll --- */}
			<section className="block-hero" aria-label="Block overview">
				<div className="block-hero-main">
					<h1 className="block-hero-height">
						#{formatNumber(currentHeight)}
						<span className={`badge badge-${block.status}`}>{block.status}</span>
					</h1>
					<p className="block-hero-meta">
						{formatDateTime(block.header.timestamp)} ·{' '}
						{timeAgo(block.header.timestamp)} · {formatSize(block.size)} ·{' '}
						{formatNumber(block.transactions.length)} tx
					</p>
				</div>

				<nav className="chain-nav" aria-label="Previous and next block">
					<Link
						className={`chain-node${prevDisabled ? ' is-disabled' : ''}`}
						to={`/block/${currentHeight - 1}`}
						aria-disabled={prevDisabled}
						onClick={(event) =>
							prevDisabled ? event.preventDefault() : undefined
						}
					>
						<span className="chain-node-label">← Previous</span>
						<span className="chain-node-value">
							#{formatNumber(currentHeight - 1)}
						</span>
					</Link>
					<span className="chain-node is-current" aria-current="page">
						<span className="chain-node-label">This block</span>
						<span className="chain-node-value">
							#{formatNumber(currentHeight)}
						</span>
					</span>
					<Link
						className={`chain-node${nextDisabled ? ' is-disabled' : ''}`}
						to={`/block/${currentHeight + 1}`}
						aria-disabled={nextDisabled}
						onClick={(event) =>
							nextDisabled ? event.preventDefault() : undefined
						}
					>
						<span className="chain-node-label">Next →</span>
						<span className="chain-node-value">
							#{formatNumber(currentHeight + 1)}
						</span>
					</Link>
				</nav>
			</section>

			{/* --- meter: konfirmasi, densitas tx, ukuran --- */}
			<section className="card" aria-label="Block meters">
				<div className="meter-grid">
					<div className="meter-block">
						<div className="meter-head">
							<span className="meter-label">Confirmations</span>
							<span className="meter-value">
								{confirmations !== undefined ? formatNumber(confirmations) : '—'}
							</span>
						</div>
						<div
							className="meter-track"
							role="img"
							aria-label={`${confirmations ?? 0} confirmations`}
						>
							<div
								className="meter-fill"
								style={{ width: `${confirmationPct}%` }}
							/>
						</div>
						<p className="stat-hint">
							{tip !== undefined
								? `Tip is #${formatNumber(tip)} · blocks start at 1 confirmation`
								: 'Waiting for chain tip…'}
						</p>
					</div>

					<div className="meter-block">
						<div className="meter-head">
							<span className="meter-label">Transactions</span>
							<span className="meter-value">{formatNumber(myTx)}</span>
						</div>
						<div
							className="meter-track"
							role="img"
							aria-label={`${densityPct} percent of the busiest nearby block`}
						>
							<div
								className={`meter-fill${densityPct >= 100 ? ' is-full' : ''}`}
								style={{ width: `${Math.max(densityPct, 2)}%` }}
							/>
						</div>
						<p className="stat-hint">
							{strip.length > 0
								? `${densityPct}% of the busiest block in this window`
								: 'Transactions recorded in this block'}
						</p>
					</div>

					<div className="meter-block">
						<div className="meter-head">
							<span className="meter-label">Block size</span>
							<span className="meter-value">{formatSize(block.size)}</span>
						</div>
						<div
							className="meter-track"
							role="img"
							aria-label={`${sizePct} percent of the largest nearby block`}
						>
							<div className="meter-fill" style={{ width: `${Math.max(sizePct, 2)}%` }} />
						</div>
						<p className="stat-hint">
							{strip.length > 0
								? `${sizePct}% of the largest block in this window`
								: 'Recorded block size'}
						</p>
					</div>
				</div>
			</section>

			<section className="stat-grid" aria-label="Block statistics">
				<StatCard
					label="Transactions"
					value={formatNumber(block.transactions.length)}
					hint={
						block.metadata
							? `metadata txCount ${formatNumber(block.metadata.txCount)}`
							: undefined
					}
					accent
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
					value={formatNumber(block.totalTransactionFees)}
					hint="sum of transaction fees"
				/>
			</section>

			{strip.length > 0 ? (
				<section className="card" aria-label="Neighbouring blocks">
					<div className="card-head">
						<h2>Around this block</h2>
					</div>
					<div className="chain-strip">
						{strip.map((candidate) => (
							<Link
								key={candidate.hash}
								to={`/block/${candidate.height}`}
								className={`strip-cell${
									candidate.height === currentHeight ? ' is-current' : ''
								}${candidate.height === tip ? ' is-tip' : ''}`}
								title={`${formatNumber(candidate.txCount)} tx · ${timeAgo(candidate.timestamp)}`}
								aria-current={
									candidate.height === currentHeight ? 'page' : undefined
								}
							>
								<span>#{formatNumber(candidate.height)}</span>
								<span className="strip-txs">
									{formatNumber(candidate.txCount)} tx
								</span>
							</Link>
						))}
					</div>
				</section>
			) : null}

			<section className="card" aria-label="Block details">
				<h2>Overview</h2>
				<dl className="kv-grid mt-md">
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
									currentHeight > 0
										? `/block/${currentHeight - 1}`
										: `/block/${block.header.previousBlockHash}`
								}
								head={18}
								tail={16}
							/>
						</dd>
					</div>
					<div className="kv">
						<dt>Timestamp</dt>
						<dd title={formatDateTime(block.header.timestamp)}>
							{formatDateTime(block.header.timestamp)} (
							{timeAgo(block.header.timestamp)})
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
						<dt>Avg block time</dt>
						<dd>
							{neighbors.data && neighbors.data.length >= 2
								? formatDuration(
										(neighbors.data[0].timestamp -
											neighbors.data[neighbors.data.length - 1].timestamp) /
											(neighbors.data.length - 1),
									)
								: '—'}
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

			<section className="card" aria-label="Transactions">
				<div className="card-head">
					<h2>
						Transactions{' '}
						<span className="muted">({formatNumber(block.transactions.length)})</span>
					</h2>
				</div>
				{block.transactions.length > 0 ? (
					<>
						<TxTable transactions={visibleTxs} />
						{txHidden > 0 ? (
							<div className="empty-actions">
								<button
									type="button"
									className="btn"
									onClick={() => setShownTxs((value) => value + TX_PAGE)}
								>
									Show {formatNumber(Math.min(TX_PAGE, txHidden))} more
								</button>
							</div>
						) : (
							<p className="muted pad-sm">
								Showing all {formatNumber(block.transactions.length)} transactions.
							</p>
						)}
					</>
				) : (
					<EmptyState
						title="No transactions in this block"
						hint="Only the coinbase reward was recorded."
					/>
				)}
			</section>

			{block.metadata ? (
				<details className="disclose">
					<summary>Metadata</summary>
					<div className="disclose-body">
						<dl className="kv-grid">
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
					</div>
				</details>
			) : null}

			<details className="disclose">
				<summary>Signature</summary>
				<div className="disclose-body">
					<dl className="kv-grid">
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
				</div>
			</details>

			<RawJson data={data} summary="Raw block JSON" />
		</div>
	)
}
