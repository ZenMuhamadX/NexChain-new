import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import type { HistoryEntry, structBalance } from '../api/types'
import { TxTable } from '../components/TxTable'
import { CopyButton } from '../components/common/CopyButton'
import { RawJson } from '../components/common/RawJson'
import { StatCard } from '../components/common/StatCard'
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from '../components/common/States'
import { useAsync } from '../hooks/useAsync'
import { ADDRESS_PATTERN } from '../lib/classify'
import {
	formatDateTime,
	formatNxc,
	formatNumber,
	timeAgo,
} from '../lib/format'

/**
 * Halaman address: saldo, nonce, jumlah transaksi, riwayat.
 * Format divalidasi dulu di client — backend melempar error untuk
 * address yang tidak valid, jadi lebih baik ditolak sebelum request.
 */
export function AddressPage() {
	const { address = '' } = useParams()
	const valid = ADDRESS_PATTERN.test(address)

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

	const balance = account.data
	const isContract = balance?.isContract === true

	// Hanya dipanggil untuk address kontrak (NxS / flag isContract).
	const contractBalance = useAsync<number | undefined>(
		async () => await rpc.getContractBalance(address),
		[address],
		{ enabled: valid && isContract },
	)

	if (!valid) {
		return (
			<div className="page">
				<EmptyState
					title="Invalid address"
					hint={
						<>
							<code>{address}</code> is not a valid NexChain address. Expected
							format: <code>NxC…</code> (wallet) or <code>NxS…</code> (contract),
							43 characters total.
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

	if (account.loading && !balance) return <LoadingState label="Loading account…" />

	if (!balance && account.error && isNotFound(account.error)) {
		return (
			<div className="page">
				<EmptyState
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
				<EmptyState
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

	return (
		<div className="page">
			<div className="card address-hero">
				<div>
					<p className="section-title" style={{ margin: 0 }}>
						{isContract ? 'Contract address' : 'Wallet address'}
					</p>
					<p className="mono" style={{ margin: '0.3rem 0 0' }}>
						{balance.address}
						{isContract ? (
							<span className="badge badge-contract">contract</span>
						) : null}
					</p>
				</div>
				<CopyButton value={balance.address} label="Copy address" />
			</div>

			<section className="stat-grid" aria-label="Account statistics">
				<StatCard
					label="Balance"
					value={formatNxc(balance.balance, 6)}
					hint={`${formatNumber(balance.balance)} nexu`}
					accent
				/>
				{isContract ? (
					<StatCard
						label="Contract balance"
						value={
							contractBalance.data !== undefined
								? formatNxc(contractBalance.data, 6)
								: contractBalance.error
									? isNotFound(contractBalance.error)
										? '—' // alamat valid tapi bukan kontrak / tanpa state
										: 'unavailable'
									: '…'
						}
						hint={isContract ? 'nex_getContractBalance' : undefined}
					/>
				) : null}
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
				<StatCard
					label="Type"
					value={isContract ? 'Contract' : 'Wallet'}
					hint={isContract ? 'NxS prefix / flagged contract' : 'NxC prefix'}
				/>
			</section>

			<section className="card" aria-label="Transaction history">
				<div className="card-head">
					<h2>
						History <span className="muted">({formatNumber(txCount)} tx)</span>
					</h2>
				</div>
				{history.loading && !history.data ? (
					<LoadingState label="Loading history…" />
				) : history.error && !history.data ? (
					<ErrorState error={history.error} onRetry={history.refresh} />
				) : txs.length > 0 ? (
					<TxTable transactions={txs as HistoryEntry[]} />
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
