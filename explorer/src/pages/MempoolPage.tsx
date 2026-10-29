import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../api/methods'
import type { TxInterface } from '../api/types'
import { TxTable } from '../components/TxTable'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAsync } from '../hooks/useAsync'
import { useChain } from '../hooks/useChainState'
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from '../components/common/States'
import { formatNumber } from '../lib/format'

const PAGE_SIZE = 25

/**
 * `nex_getMempool` memotong hasil di 100 entri secara GLOBAL (urut key),
 * bukan per halaman. Angka itu karena itu BUKAN ukuran backlog sebenarnya:
 * mempool 5.000 tx tetap tampil "100". Selalu tandai cap-nya, jangan
 * menyajikan potongan sebagai total.
 */
const RPC_LIMIT = 100

/**
 * Halaman Mempool — satu-satunya jalur "browse global" yang tersedia di
 * backend saat ini (`nex_getMempool`). Sebelumnya mempool hanya muncul
 * sebagai preview 8 baris di dashboard tanpa jalan menuju datanya.
 */
export function MempoolPage() {
	useDocumentTitle('Mempool')
	const chain = useChain()
	const [shown, setShown] = useState(PAGE_SIZE)

	const pool = useAsync(() => rpc.getMempool(), [], { pollMs: 8000 })

	const pending = pool.data ?? []
	const visible = pending.slice(0, shown)
	const hasMore = pending.length > shown
	const capped = pending.length >= RPC_LIMIT

	if (pool.loading && !pool.data) {
		return <LoadingState label="Loading mempool…" />
	}
	if (pool.error && !pool.data) {
		return (
			<ErrorState
				error={pool.error}
				onRetry={pool.refresh}
				title="Mempool unavailable"
			/>
		)
	}

	return (
		<div className="page">
			<div className="page-head">
				<div>
					<h1>Mempool</h1>
					<p className="muted">
						{formatNumber(pending.length)}
						{capped ? '+' : ''} transaction
						{pending.length === 1 ? '' : 's'} waiting to be mined · tip #
						{formatNumber(chain.state?.currentBlockHeight ?? 0)}
					</p>
					{capped ? (
						<p className="muted">
							The RPC returns at most {RPC_LIMIT} entries (global key order),
							so the real backlog may be larger. This list is a sample, not a
							count.
						</p>
					) : null}
				</div>
			</div>

			<section
				className="panel table-panel"
				aria-labelledby="mempool-records-title"
			>
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Blockchain</p>
						<h2 id="mempool-records-title">Pending Transaction Records</h2>
					</div>
					<span className="panel-meta">
						{formatNumber(visible.length)} of {formatNumber(pending.length)}{' '}
						shown
					</span>
				</div>
				<div className="panel-body table-panel-body">
					{visible.length > 0 ? (
						<>
							<TxTable transactions={visible} />
							{hasMore ? (
								<div className="empty-actions">
									<button
										type="button"
										className="btn"
										onClick={() => setShown((value) => value + PAGE_SIZE)}
									>
										Show{' '}
										{formatNumber(Math.min(PAGE_SIZE, pending.length - shown))}{' '}
										more
									</button>
								</div>
							) : (
								<p className="muted pad-sm">
									Showing all {formatNumber(pending.length)} pending
									transactions.
								</p>
							)}
						</>
					) : (
						<EmptyState
							title="Mempool is empty"
							hint="No transactions are waiting to be mined."
							action={
								<Link className="btn btn-primary" to="/blocks">
									Browse blocks
								</Link>
							}
						/>
					)}
				</div>
			</section>
		</div>
	)
}
