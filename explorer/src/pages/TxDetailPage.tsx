import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { tryHexText } from '../api/decoder'
import { isNotFound } from '../api/rpcClient'
import type { HistoryEntry } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { HashValue } from '../components/common/HashValue'
import { RawJson } from '../components/common/RawJson'
import { PageSkeleton } from '../components/common/Skeleton'
import { EmptyState, ErrorState } from '../components/common/States'
import { Unit } from '../components/common/Unit'
import { useAsync } from '../hooks/useAsync'
import { useChain } from '../hooks/useChainState'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
	formatDateTime,
	formatNxc,
	formatNxcExact,
	formatNumber,
	timeAgo,
	truncateMiddle,
} from '../lib/format'

export function TxDetailPage() {
	const { hash = '' } = useParams()
	const chain = useChain()
	const {
		data: tx,
		error,
		loading,
		refresh,
	} = useAsync<HistoryEntry | undefined>(
		async () => await rpc.getTransactionByHash(hash),
		[hash],
	)

	useDocumentTitle(`Transaction ${truncateMiddle(hash, 12, 10)}`)

	if (loading && !tx) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Transaction' }]} />
				<PageSkeleton label="Loading transaction…" />
			</div>
		)
	}

	if (error && isNotFound(error)) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Transaction' }]} />
				<EmptyState
					titleAs="h1"
					title="Transaction not found"
					hint={
						<>
							No transaction matches <code>{hash}</code>. Mempool transactions
							are only visible after they are saved to history.
						</>
					}
					action={
						<Link className="btn btn-primary" to="/mempool">
							View pending transactions
						</Link>
					}
				/>
			</div>
		)
	}
	if (error && !tx) {
		return <ErrorState error={error} onRetry={refresh} />
	}
	if (!tx) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Transaction' }]} />
				<EmptyState
					titleAs="h1"
					title="Transaction not found"
					hint={
						<>
							No transaction matches <code>{hash}</code>.
						</>
					}
					action={
						<Link className="btn btn-primary" to="/">
							Back to dashboard
						</Link>
					}
				/>
			</div>
		)
	}

	const meta = tx.metadata
	const tip = chain.state?.currentBlockHeight
	const confirmations =
		meta && tip !== undefined
			? Math.max(tip - meta.blockHeight + 1, 1)
			: undefined
	const txHash = tx.txHash ?? hash

	return (
		<div className="page detail-page">
			<Breadcrumbs
				items={[
					...(meta ? [{ label: 'Blocks', to: '/blocks' }] : []),
					...(meta
						? [
								{
									label: `#${formatNumber(meta.blockHeight)}`,
									to: `/block/${meta.blockHeight}`,
								},
							]
						: []),
					{ label: `Tx ${truncateMiddle(txHash, 8, 6)}` },
				]}
			/>

			<section className="detail-header" aria-labelledby="tx-title">
				<div className="detail-heading">
					<p className="detail-eyebrow">Transaction</p>
					<h1 id="tx-title">
						{meta ? 'Transaction' : 'Pending Transaction'}
						<span className={`badge badge-${meta ? 'confirmed' : 'pending'}`}>
							{meta ? 'confirmed' : 'pending'}
						</span>
					</h1>
					<p>
						{meta
							? `${formatDateTime(meta.blockTimestamp)} · ${timeAgo(meta.blockTimestamp)}`
							: 'Belum masuk blok'}
						{confirmations !== undefined
							? ` · ${formatNumber(confirmations)} confirmations`
							: ''}
					</p>
				</div>
				<div className="detail-hash">
					<span>Transaction hash</span>
					<HashValue value={txHash} head={16} tail={14} />
				</div>
			</section>

			<section className="panel" aria-labelledby="tx-overview-title">
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Transaction data</p>
						<h2 id="tx-overview-title">Overview</h2>
					</div>
					<span className="panel-meta">
						{meta ? `Block #${formatNumber(meta.blockHeight)}` : 'Pending'}
					</span>
				</div>
				<div className="panel-body">
					<dl className="detail-grid">
						<div className="detail-row detail-row-full">
							<dt>Transaction hash</dt>
							<dd>
								<HashValue value={txHash} head={20} tail={18} />
							</dd>
						</div>
						<div className="detail-row">
							<dt>Status</dt>
							<dd>
								<span className={`badge badge-${meta ? 'confirmed' : 'pending'}`}>
									{meta ? 'confirmed' : 'pending'}
								</span>
							</dd>
						</div>
						<div className="detail-row">
							<dt>Block</dt>
							<dd>
								{meta ? (
									<Link to={`/block/${meta.blockHeight}`}>
										#{formatNumber(meta.blockHeight)}
									</Link>
								) : (
									'Pending'
								)}
							</dd>
						</div>
						<div className="detail-row">
							<dt>Timestamp</dt>
							<dd>
								{meta ? formatDateTime(meta.blockTimestamp) : 'Belum masuk blok'}
							</dd>
						</div>
						<div className="detail-row">
							<dt>Confirmations</dt>
							<dd>
								{confirmations !== undefined
									? formatNumber(confirmations)
									: '—'}
							</dd>
						</div>
						<div className="detail-row">
							<dt>Amount</dt>
							<dd>{formatNxc(tx.amount, 6)}</dd>
						</div>
						<div className="detail-row">
							<dt>Amount (exact)</dt>
							<dd className="mono">{formatNxcExact(tx.amount)} NXC</dd>
						</div>
						<div className="detail-row">
							<dt>Transaction fee</dt>
							<dd>
								<Unit>{formatNumber(tx.fee)}</Unit>
							</dd>
						</div>
						<div className="detail-row">
							<dt>Nonce</dt>
							<dd>{formatNumber(tx.nonce)}</dd>
						</div>
						{meta ? (
							<div className="detail-row detail-row-full">
								<dt>Source block</dt>
								<dd>
									<Link to={`/block/${meta.blockHeight}`}>
										#{formatNumber(meta.blockHeight)}
									</Link>
									<HashValue
										value={meta.blockHash}
										link={`/block/${meta.blockHash}`}
										head={14}
										tail={12}
									/>
									<span className="muted">
										mined {timeAgo(meta.blockTimestamp)}
									</span>
								</dd>
							</div>
						) : null}
					</dl>
				</div>
			</section>

			<section className="panel" aria-labelledby="tx-transfer-title">
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Value transfer</p>
						<h2 id="tx-transfer-title">From / To</h2>
					</div>
					<span className="panel-meta">{formatNxc(tx.amount, 6)}</span>
				</div>
				<div className="panel-body">
					<div className="transfer-flow">
						<div className="transfer-party">
							<span>From</span>
							<Link className="mono" to={`/address/${tx.from ?? ''}`}>
								{tx.from ?? '—'}
							</Link>
						</div>
						<div className="transfer-arrow" aria-hidden="true">
							→
						</div>
						<div className="transfer-party">
							<span>To</span>
							<Link className="mono" to={`/address/${tx.receiver}`}>
								{tx.receiver}
							</Link>
						</div>
					</div>
				</div>
			</section>

			{tx.data ? (
				<section className="panel" aria-labelledby="tx-data-title">
					<div className="panel-head">
						<h2 id="tx-data-title">Data</h2>
					</div>
					<div className="panel-body">
						<RawInput hex={tx.data} />
					</div>
				</section>
			) : null}

			<details className="disclose">
				<summary>Signature</summary>
				<div className="disclose-body">
					<dl className="detail-grid">
						<div className="detail-row">
							<dt>v</dt>
							<dd className="mono">{tx.sign.v}</dd>
						</div>
						<div className="detail-row detail-row-full">
							<dt>r</dt>
							<dd>
								<HashValue value={tx.sign.r} head={24} tail={20} />
							</dd>
						</div>
						<div className="detail-row detail-row-full">
							<dt>s</dt>
							<dd>
								<HashValue value={tx.sign.s} head={24} tail={20} />
							</dd>
						</div>
					</dl>
				</div>
			</details>

			<RawJson data={tx} summary="Raw transaction JSON" />
		</div>
	)
}

function RawInput({ hex }: { hex: string }) {
	const text = tryHexText(hex)
	return <p className="tx-message mono">{text ?? hex}</p>
}
