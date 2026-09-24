import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import { tryHexText } from '../api/decoder'
import type { HistoryEntry } from '../api/types'
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
	formatNxc,
	formatNxcExact,
	formatNumber,
	timeAgo,
} from '../lib/format'

/** Detail transaksi berdasarkan tx hash. */
export function TxDetailPage() {
	const { hash = '' } = useParams()
	const chain = useChain()

	const { data: tx, error, loading, refresh } = useAsync<
		HistoryEntry | undefined
	>(async () => await rpc.getTransactionByHash(hash), [hash])

	if (loading && !tx) return <LoadingState label="Loading transaction…" />

	if (error && isNotFound(error)) {
		return (
			<div className="page">
				<EmptyState
					title="Transaction not found"
					hint={
						<>
							No transaction matches <code>{hash}</code>. Mempool transactions
							are only visible after they are saved to history.
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
	if (error && !tx) return <ErrorState error={error} onRetry={refresh} />
	if (!tx) {
		return (
			<div className="page">
				<EmptyState
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
		meta && tip !== undefined ? Math.max(tip - meta.blockHeight + 1, 1) : undefined

	return (
		<div className="page">
			<div className="page-head">
				<div>
					<h1>
						Transaction{' '}
						<span className={`badge badge-${tx.status}`}>{tx.status}</span>
					</h1>
					<p className="muted">
						{formatDateTime(tx.timestamp)} · {timeAgo(tx.timestamp)}
					</p>
				</div>
			</div>

			<section className="stat-grid" aria-label="Transaction statistics">
				<StatCard
					label="Amount"
					value={formatNxc(tx.amount, 6)}
					hint={`${formatNxcExact(tx.amount)} NXC`}
					accent
				/>
				<StatCard label="Fee" value={`${formatNumber(tx.fee)} nexu`} />
				<StatCard
					label="Block"
					value={
						meta ? (
							<Link className="link" to={`/block/${meta.blockHeight}`}>
								#{formatNumber(meta.blockHeight)}
							</Link>
						) : (
							'—'
						)
					}
					hint={
						meta
							? confirmations !== undefined
								? `${formatNumber(confirmations)} confirmations`
								: undefined
							: 'metadata not recorded'
					}
				/>
				<StatCard
					label="Validity"
					value={tx.isValid ? 'valid' : 'invalid'}
					hint={tx.isPending ? 'still pending' : 'settled'}
				/>
				<StatCard label="Format" value={tx.format} hint="wallet ↔ wallet" />
				<StatCard
					label="Confirmations"
					value={confirmations !== undefined ? formatNumber(confirmations) : '—'}
					hint={tip !== undefined ? `tip #${formatNumber(tip)}` : undefined}
				/>
			</section>

			<section className="card" aria-label="Transfer">
				<h2>Transfer</h2>
				<dl className="kv-grid" style={{ marginTop: '0.75rem' }}>
					<div className="kv kv-full">
						<dt>TxHash</dt>
						<dd>
							<HashValue value={tx.txHash ?? hash} head={20} tail={18} />
						</dd>
					</div>
					<div className="kv kv-full">
						<dt>From</dt>
						<dd>
							<Link className="link mono" to={`/address/${tx.sender}`}>
								{tx.sender}
							</Link>
						</dd>
					</div>
					<div className="kv kv-full">
						<dt>To</dt>
						<dd>
							<Link className="link mono" to={`/address/${tx.receiver}`}>
								{tx.receiver}
							</Link>
						</dd>
					</div>
					<div className="kv">
						<dt>Timestamp</dt>
						<dd title={formatDateTime(tx.timestamp)}>
							{formatDateTime(tx.timestamp)}
						</dd>
					</div>
					<div className="kv">
						<dt>Status</dt>
						<dd>
							<span className={`badge badge-${tx.status}`}>{tx.status}</span>
							{tx.isValid ? null : (
								<span className="badge badge-rejected">invalid</span>
							)}
						</dd>
					</div>
					{meta ? (
						<div className="kv kv-full">
							<dt>Source block</dt>
							<dd>
								<Link className="link" to={`/block/${meta.blockHeight}`}>
									#{formatNumber(meta.blockHeight)}
								</Link>
								<HashValue
									value={meta.blockHash}
									link={`/block/${meta.blockHash}`}
									head={14}
									tail={12}
								/>
								<span className="muted" title={formatDateTime(meta.blockTimestamp)}>
									mined {timeAgo(meta.blockTimestamp)}
								</span>
							</dd>
						</div>
					) : null}
				</dl>
			</section>

			{tx.extraMessage ? (
				<section className="card" aria-label="Message">
					<h2>Message</h2>
					<p className="tx-message" style={{ marginTop: '0.75rem' }}>
						{tx.extraMessage}
					</p>
				</section>
			) : null}

			{tx.hexInput ? (
				<section className="card" aria-label="Raw input">
					<h2>Raw input</h2>
					{(() => {
						const text = tryHexText(tx.hexInput)
						return (
							<p className="tx-message mono" style={{ marginTop: '0.75rem' }}>
								{text ?? tx.hexInput}
							</p>
						)
					})()}
				</section>
			) : null}

			<section className="card" aria-label="Signature">
				<h2>Signature</h2>
				<dl className="kv-grid" style={{ marginTop: '0.75rem' }}>
					<div className="kv">
						<dt>v</dt>
						<dd className="mono">{tx.sign.v}</dd>
					</div>
					<div className="kv kv-full">
						<dt>r</dt>
						<dd>
							<HashValue value={tx.sign.r} head={24} tail={20} />
						</dd>
					</div>
					<div className="kv kv-full">
						<dt>s</dt>
						<dd>
							<HashValue value={tx.sign.s} head={24} tail={20} />
						</dd>
					</div>
				</dl>
			</section>

			<RawJson data={tx} summary="Raw transaction JSON" />
		</div>
	)
}
