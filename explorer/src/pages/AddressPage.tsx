import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import type { HistoryEntry, structBalance } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { TxTable } from '../components/TxTable'
import { CopyButton } from '../components/common/CopyButton'
import { RawJson } from '../components/common/RawJson'
import { PageSkeleton, SkeletonTable } from '../components/common/Skeleton'
import { EmptyState, ErrorState } from '../components/common/States'
import { useAsync } from '../hooks/useAsync'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { ADDRESS_PATTERN } from '../lib/classify'
import {
	formatDateTime,
	formatNxc,
	formatNxcExact,
	formatNumber,
	timeAgo,
	truncateMiddle,
} from '../lib/format'

const PAGE_SIZE = 25

export function AddressPage() {
	const { address = '' } = useParams()
	const valid = ADDRESS_PATTERN.test(address)
	const [page, setPage] = useState(1)

	useDocumentTitle(valid ? `Address ${address.slice(0, 10)}…` : 'Address')

	const account = useAsync<structBalance | undefined>(
		async () => await rpc.getAccount(address),
		[address],
		{ enabled: valid },
	)
	const history = useAsync(
		async () => await rpc.getTransactionsByAddress(address),
		[address],
		{ enabled: valid },
	)

	useEffect(() => {
		setPage(1)
	}, [address])

	const balance = account.data

	if (!valid) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Address' }]} />
				<EmptyState
					titleAs="h1"
					title="Invalid address"
					hint={
						<>
							<code>{address}</code> is not a valid NexChain address. Expected
							format: <code>NxC…</code>, 43 characters total.
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

	if (account.loading && !balance) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: address }]} />
				<PageSkeleton label="Loading account…" />
			</div>
		)
	}

	if (!balance && account.error && isNotFound(account.error)) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: address }]} />
				<EmptyState
					titleAs="h1"
					title="Account not found"
					hint={
						<>
							Address <code>{address}</code> has no state on this chain.
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
	if (!balance && account.error) {
		return <ErrorState error={account.error} onRetry={account.refresh} />
	}
	if (!balance) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: address }]} />
				<EmptyState
					titleAs="h1"
					title="Account not found"
					hint={
						<>
							Address <code>{address}</code> returned no data.
						</>
					}
					action={
						<button type="button" className="btn" onClick={account.refresh}>
							Retry
						</button>
					}
				/>
			</div>
		)
	}

	const txs = history.data?.history ?? []
	const txCount = history.data?.count ?? 0
	const totalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE))
	const current = Math.min(page, totalPages)
	const start = (current - 1) * PAGE_SIZE
	const visible = txs.slice(start, start + PAGE_SIZE)

	return (
		<div className="page detail-page">
			<Breadcrumbs
				items={[{ label: `Address ${truncateMiddle(address, 12, 10)}` }]}
			/>

			<section className="detail-header" aria-labelledby="address-title">
				<div className="detail-heading">
					<p className="detail-eyebrow">Blockchain</p>
					<h1 id="address-title">Address</h1>
					<p className="mono">{truncateMiddle(balance.address, 18, 14)}</p>
				</div>
				<div className="detail-hash">
					<span>Wallet address</span>
					<div className="address-value-row">
						<code>{balance.address}</code>
						<CopyButton value={balance.address} label="Copy address" />
					</div>
				</div>
			</section>

			<section className="panel" aria-labelledby="address-overview-title">
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Account data</p>
						<h2 id="address-overview-title">Overview</h2>
					</div>
					<span className="panel-meta">Wallet</span>
				</div>
				<div className="panel-body">
					<dl className="detail-grid">
						<div className="detail-row detail-row-full">
							<dt>Address</dt>
							<dd>
								<code>{balance.address}</code>
								<CopyButton value={balance.address} label="Copy address" />
							</dd>
						</div>
						<div className="detail-row">
							<dt>Balance</dt>
							<dd>{formatNxc(balance.balance, 6)}</dd>
						</div>
						<div className="detail-row">
							<dt>Balance (exact)</dt>
							<dd className="mono">{formatNxcExact(balance.balance)} NXC</dd>
						</div>
						<div className="detail-row">
							<dt>Nonce</dt>
							<dd>{formatNumber(balance.nonce)}</dd>
						</div>
						<div className="detail-row">
							<dt>Transactions</dt>
							<dd>{formatNumber(balance.transactionCount)}</dd>
						</div>
						<div className="detail-row">
							<dt>Last activity</dt>
							<dd>
								{balance.lastTransactionDate
									? timeAgo(balance.lastTransactionDate)
									: 'No transactions'}
							</dd>
						</div>
						<div className="detail-row">
							<dt>Last transaction date</dt>
							<dd>
								{balance.lastTransactionDate
									? formatDateTime(balance.lastTransactionDate)
									: '—'}
							</dd>
						</div>
					</dl>
				</div>
			</section>

			<section
				className="panel table-panel"
				aria-labelledby="address-history-title"
			>
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Blockchain activity</p>
						<h2 id="address-history-title">
							Transaction History{' '}
							<span className="heading-count">{formatNumber(txCount)}</span>
						</h2>
					</div>
					{totalPages > 1 ? (
						<div className="pager">
							<button
								type="button"
								className="btn"
								disabled={current <= 1}
								onClick={() => setPage(current - 1)}
							>
								← Newer
							</button>
							<span className="pager-page">
								Page {formatNumber(current)} of {formatNumber(totalPages)}
							</span>
							<button
								type="button"
								className="btn"
								disabled={current >= totalPages}
								onClick={() => setPage(current + 1)}
							>
								Older →
							</button>
						</div>
					) : null}
				</div>
				<div className="panel-body table-panel-body">
					{history.loading && !history.data ? (
						<div className="state-block" role="status" aria-live="polite">
							<span className="sr-only">Loading history…</span>
							<SkeletonTable rows={6} cols={5} />
						</div>
					) : history.error && !history.data ? (
						<ErrorState error={history.error} onRetry={history.refresh} />
					) : visible.length > 0 ? (
						<TxTable transactions={visible as HistoryEntry[]} />
					) : (
						<EmptyState
							title="No transactions yet"
							hint="This address has no recorded transaction history on-chain."
						/>
					)}
				</div>
			</section>

			<RawJson data={balance} summary="Raw account JSON" />
		</div>
	)
}
