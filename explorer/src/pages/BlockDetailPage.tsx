import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { tryHexText } from '../api/decoder'
import { isNotFound } from '../api/rpcClient'
import type { BlockResponse } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { TxTable } from '../components/TxTable'
import { HashValue } from '../components/common/HashValue'
import { RawJson } from '../components/common/RawJson'
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

export function BlockDetailPage() {
	const { id = '' } = useParams()
	const chain = useChain()
	const [shownTxs, setShownTxs] = useState(TX_PAGE)
	/** Overview default RINGKAS: 3 pasang baris inti. Sisanya saat di-expand. */
	const [expanded, setExpanded] = useState(false)

	const byHeight = /^\d+$/.test(id)
	const byHash = HASH.test(id)
	const cleanHash = id.replace(/^0x/, '')

	const { data, error, loading, refresh } = useAsync<
		BlockResponse | undefined
	>(async () => {
		if (byHeight) return await rpc.getBlockByHeight(Number(id))
		if (byHash) return rpc.getBlockByHash(cleanHash)
		return undefined
	}, [id])

	const heightParam = byHeight ? Number(id) : undefined
	const tip = chain.state?.currentBlockHeight
	const neighbors = useAsync(
		() => rpc.getBlocksRange(Math.min((heightParam ?? 0) + 3, tip ?? 0), 7),
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
				<Breadcrumbs
					items={[{ label: 'Blocks', to: '/blocks' }, { label: 'Invalid' }]}
				/>
				<EmptyState
					titleAs="h1"
					title="Invalid block reference"
					hint={
						<>
							<code>{id}</code> is neither a height nor a 64-character hash.
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

	if ((data === undefined && !error) || (error && isNotFound(error))) {
		return (
			<div className="page">
				<Breadcrumbs
					items={[{ label: 'Blocks', to: '/blocks' }, { label: id }]}
				/>
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
	const confirmations =
		tip !== undefined ? Math.max(tip - currentHeight + 1, 1) : undefined
	const averageBlockTime =
		neighbors.data && neighbors.data.length >= 2
			? (neighbors.data[0].timestamp -
					neighbors.data[neighbors.data.length - 1].timestamp) /
				(neighbors.data.length - 1)
			: undefined
	const visibleTxs = block.transactions.slice(0, shownTxs)
	const txHidden = block.transactions.length - visibleTxs.length

	return (
		<div className="page detail-page">
			<Breadcrumbs
				items={[
					{ label: 'Blocks', to: '/blocks' },
					{ label: `#${formatNumber(currentHeight)}` },
				]}
			/>

			<section className="detail-header" aria-labelledby="block-title">
				<div className="detail-heading">
					<p className="detail-eyebrow">Block</p>
					<h1 id="block-title">
						#{formatNumber(currentHeight)}
						<span className={`badge badge-${block.status}`}>
							{block.status}
						</span>
					</h1>
					<p>
						{formatDateTime(block.header.timestamp)} ·{' '}
						{timeAgo(block.header.timestamp)} ·{' '}
						{formatNumber(block.transactions.length)} transactions
					</p>
				</div>
				<div className="detail-hash">
					<span>Block hash</span>
					<HashValue value={block.header.hash} head={16} tail={14} />
				</div>
			</section>

			<nav
				className="chain-nav chain-nav-panel"
				aria-label="Previous and next block"
			>
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
					<span className="chain-node-label">Current block</span>
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

			<section className="panel" aria-labelledby="block-overview-title">
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Block data</p>
						<h2 id="block-overview-title">Overview</h2>
					</div>
					<div className="panel-head-actions">
						<span className="panel-meta">
							{confirmations !== undefined
								? `${formatNumber(confirmations)} confirmations`
								: 'Waiting for chain tip'}
						</span>
						<button
							type="button"
							className="panel-toggle"
							aria-expanded={expanded}
							aria-controls="block-overview"
							onClick={() => setExpanded((value) => !value)}
						>
							{expanded ? 'Show less' : 'Show all details'}
						</button>
					</div>
				</div>
				<div className="panel-body">
					{/* Semua baris BERPASANGAN (tidak ada `detail-row-full`) supaya
					    kolomnya simetris: label kiri/kanan selalu di x yang sama dan
					    nilai selalu mulai di x yang sama. Jumlah field dijaga GENAP
					    (22) supaya tidak ada sel kanan kosong — `metadata.txCount`
					    sengaja tidak ditampilkan karena selalu sama dengan jumlah
					    transaksi (diverifikasi pada blok 30–37). */}
					<dl
						className="detail-grid detail-grid-tidy"
						id="block-overview"
					>
						<div className="detail-row">
							<dt>Height</dt>
							<dd>#{formatNumber(currentHeight)}</dd>
						</div>
						<div className="detail-row">
							<dt>Hash</dt>
							<dd>
								<HashValue value={block.header.hash} head={14} tail={12} />
							</dd>
						</div>
						<div className="detail-row">
							<dt>Parent hash</dt>
							<dd>
								<HashValue
									value={block.header.previousBlockHash}
									link={
										currentHeight > 0
											? `/block/${currentHeight - 1}`
											: `/block/${block.header.previousBlockHash}`
									}
									head={14}
									tail={12}
								/>
							</dd>
						</div>
						<div className="detail-row">
							<dt>Timestamp</dt>
							<dd>{formatDateTime(block.header.timestamp)}</dd>
						</div>
						<div className="detail-row">
							<dt>Merkle root</dt>
							<dd title="Leaf = txHash. A block with a single transaction has merkleRoot === that TxC… hash; an empty block uses sha256('').">
								<HashValue value={block.merkleRoot} head={14} tail={12} />
							</dd>
						</div>
						<div className="detail-row">
							<dt>State root</dt>
							<dd title="Commitment to the account state after this block (chained-diff accumulator, not a trie).">
								{block.header.stateRoot ? (
									<HashValue
										value={block.header.stateRoot}
										head={14}
										tail={12}
									/>
								) : (
									'—'
								)}
							</dd>
						</div>
						{expanded ? (
							<>
								<div className="detail-row">
									<dt>Status</dt>
									<dd>
										<span className={`badge badge-${block.status}`}>
											{block.status}
										</span>
									</dd>
								</div>
								<div className="detail-row">
									<dt>Transactions</dt>
									<dd title="User transactions only — the coinbase reward is not a transaction">
										{formatNumber(block.transactions.length)}
									</dd>
								</div>
								<div className="detail-row">
									<dt>Average block time</dt>
									<dd>
										{averageBlockTime !== undefined
											? formatDuration(averageBlockTime)
											: '—'}
									</dd>
								</div>
								<div className="detail-row">
									<dt>Size</dt>
									<dd title="Σ wire bytes of the user transactions. The coinbase reward and the JSON envelope are not counted, so genesis is 0.">
										{formatSize(block.size)}
									</dd>
								</div>
								<div className="detail-row">
									<dt>Difficulty</dt>
									<dd>{formatNumber(block.header.difficulty)}</dd>
								</div>
								<div className="detail-row">
									<dt>Hashing algorithm</dt>
									<dd>{block.header.hashingAlgorithm}</dd>
								</div>
								<div className="detail-row">
									<dt>Block reward</dt>
									<dd>{formatNxc(block.blockReward, 6)}</dd>
								</div>
								<div className="detail-row">
									<dt>Total reward</dt>
									<dd>{formatNxc(block.totalReward, 6)}</dd>
								</div>
								<div className="detail-row">
									<dt>Transaction fees</dt>
									<dd>{formatNxc(block.totalTransactionFees, 6)}</dd>
								</div>
								<div className="detail-row">
									<dt>Chain ID</dt>
									<dd>{block.chainId ?? chain.chainId ?? '—'}</dd>
								</div>
								<div className="detail-row">
									<dt>Version</dt>
									<dd>{block.header.version}</dd>
								</div>
								<div className="detail-row">
									<dt>Nonce</dt>
									<dd className="mono">{formatNumber(block.header.nonce)}</dd>
								</div>
								<div className="detail-row">
									<dt>Miner</dt>
									<dd>
										<HashValue
											value={block.minerId}
											link={`/address/${block.minerId}`}
											head={12}
											tail={10}
										/>
									</dd>
								</div>
								<div className="detail-row">
									<dt>Coinbase receiver</dt>
									<dd
										title={`${block.coinbaseTransaction.receiver} — ${formatNxc(block.coinbaseTransaction.amount, 6)}${coinbaseText ? ` · "${coinbaseText}"` : ''}`}
									>
										<HashValue
											value={block.coinbaseTransaction.receiver}
											link={`/address/${block.coinbaseTransaction.receiver}`}
											head={12}
											tail={10}
										/>
										<span className="muted">
											{formatNxc(block.coinbaseTransaction.amount, 6)}
										</span>
									</dd>
								</div>
								{block.metadata ? (
									<>
										<div className="detail-row">
											<dt>Created at</dt>
											<dd>{formatDateTime(block.metadata.created_at)}</dd>
										</div>
										<div className="detail-row">
											<dt>Extra data</dt>
											<dd
												title={
													metaText
														? `"${metaText}"`
														: block.metadata.extraData
												}
											>
												{metaText ? (
													`"${metaText}"`
												) : (
													<code>{block.metadata.extraData}</code>
												)}
											</dd>
										</div>
									</>
								) : null}
							</>
						) : null}
					</dl>
				</div>
			</section>

			<section
				className="panel table-panel"
				aria-labelledby="block-transactions-title"
			>
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Included transactions</p>
						<h2 id="block-transactions-title">
							Transactions{' '}
							<span className="heading-count">
								{formatNumber(block.transactions.length)}
							</span>
						</h2>
					</div>
				</div>
				<div className="panel-body table-panel-body">
					{block.transactions.length > 0 ? (
						<>
							<TxTable transactions={visibleTxs} />
							{txHidden > 0 ? (
								<div className="panel-actions">
									<button
										type="button"
										className="btn"
										onClick={() => setShownTxs((value) => value + TX_PAGE)}
									>
										Show {formatNumber(Math.min(TX_PAGE, txHidden))} more
									</button>
								</div>
							) : null}
						</>
					) : (
						<EmptyState
							title="No transactions in this block"
							hint="Only the coinbase reward was recorded."
						/>
					)}
				</div>
			</section>

			<RawJson data={data} summary="Raw block JSON" />
		</div>
	)
}
