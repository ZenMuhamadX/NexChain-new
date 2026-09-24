import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import type { HistoryEntry, structBalance } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { TxTable } from '../components/TxTable'
import { CopyButton } from '../components/common/CopyButton'
import { RawJson } from '../components/common/RawJson'
import { StatCard } from '../components/common/StatCard'
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

/**
 * Halaman address: saldo, nonce, jumlah transaksi, riwayat.
 * Format divalidasi dulu di client — backend melempar error untuk
 * address yang tidak valid, jadi lebih baik ditolak sebelum request.
 *
 * Riwayat dipaging di sisi klien: endpoint mengembalikan SELURUH history
 * dalam satu respons, sehingga tanpa pagination alamat dengan ribuan
 * transaksi akan me-render semuanya sekaligus dan menghentikan browser.
 */
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
		<div className="page">
			<Breadcrumbs items={[{ label: `Address ${address.slice(0, 12)}…` }]} />

			<div className="page-head">
				<div>
					<h1>
						Address{' '}
						<span className="mono muted">{truncateMiddle(address, 12, 10)}</span>
					</h1>
					<p className="muted">Balance, nonce and transaction history.</p>
				</div>
			</div>

			<div className="card address-hero">
				<div className="address-hero-main">
					<p className="section-title">Wallet address</p>
					<p className="address-hero-value mono">{balance.address}</p>
				</div>
				<CopyButton value={balance.address} label="Copy address" />
			</div>

			<section className="stat-grid" aria-label="Account statistics">
				<StatCard
					label="Balance"
					value={formatNxc(balance.balance, 6)}
					hint={`${formatNxcExact(balance.balance)} NXC`}
					accent
				/>
				<StatCard label="Nonce" value={formatNumber(balance.nonce)} />
				<StatCard
					label="Transactions"
					value={formatNumber(balance.transactionCount)}
					hint={txCount > 0 ? `${formatNumber(txCount)} in history` : undefined}
				/>
				<StatCard
					label="Last activity"
					value={
						balance.lastTransactionDate
							? timeAgo(balance.lastTransactionDate)
							: 'never'
					}
					hint={
						balance.lastTransactionDate
							? formatDateTime(balance.lastTransactionDate)
							: undefined
					}
				/>
				<StatCard label="Type" value="Wallet" hint="NxC prefix" />
			</section>

			<section className="card" aria-label="Transaction history">
				<div className="card-head">
					<h2>
						History <span className="muted">({formatNumber(txCount)} tx)</span>
					</h2>
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
			</section>

			<RawJson data={balance} summary="Raw account JSON" />
		</div>
	)
}
