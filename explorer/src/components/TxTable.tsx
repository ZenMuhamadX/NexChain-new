import { Link } from 'react-router-dom'
import type { HistoryEntry } from '../api/types'
import {
	formatDateTime,
	formatNxc,
	formatNumber,
	timeAgo,
	truncateMiddle,
} from '../lib/format'
import { Unit } from './common/Unit'

/** Badge status transaksi. */
export function TxStatus({ status }: { status: HistoryEntry['status'] }) {
	return <span className={`badge badge-${status}`}>{status}</span>
}

/**
 * Tabel transaksi umum — dipakai di detail blok, mempool, dan riwayat
 * address. Kolom "Block" hanya muncul kalau minimal satu entry punya
 * metadata blok (backend saat ini tidak selalu mengisinya).
 *
 * Di ≤760px tabel berubah menjadi daftar kartu (lihat `.table-responsive`)
 * karena delapan kolom `nowrap` memaksa scroll horizontal di layar 360px
 * tanpa ada petunjuk sama sekali.
 */
export function TxTable({
	transactions,
}: {
	transactions: (HistoryEntry | undefined)[]
}) {
	const rows = transactions.filter(
		(tx): tx is HistoryEntry => tx !== undefined,
	)
	if (rows.length === 0) return null

	const showBlock = rows.some((tx) => tx.metadata !== undefined)

	return (
		<div className="table-wrap">
			<table className="table table-responsive">
				<caption className="sr-only">
					Transactions — hash, sender, receiver, amount, fee, age and status
				</caption>
				<thead>
					<tr>
						<th scope="col">TxHash</th>
						<th scope="col">From</th>
						<th scope="col">To</th>
						<th scope="col" className="num">
							Amount
						</th>
						<th scope="col" className="num">
							Fee
						</th>
						<th scope="col">Age</th>
						<th scope="col">Status</th>
						{showBlock ? (
							<th scope="col" className="num">
								Block
							</th>
						) : null}
					</tr>
				</thead>
				<tbody>
					{rows.map((tx, index) => (
						<tr key={tx.txHash ?? `${tx.sender}-${tx.timestamp}-${index}`}>
							<td data-label="TxHash">
								{tx.txHash ? (
									<Link
										className="link mono"
										to={`/tx/${tx.txHash}`}
										title={tx.txHash}
									>
										{truncateMiddle(tx.txHash, 8, 6)}
									</Link>
								) : (
									<span className="muted">—</span>
								)}
							</td>
							<td data-label="From">
								<Link
									className="link mono"
									to={`/address/${tx.sender}`}
									title={tx.sender}
								>
									{truncateMiddle(tx.sender, 8, 6)}
								</Link>
							</td>
							<td data-label="To">
								<Link
									className="link mono"
									to={`/address/${tx.receiver}`}
									title={tx.receiver}
								>
									{truncateMiddle(tx.receiver, 8, 6)}
								</Link>
							</td>
							<td data-label="Amount" className="num">
								{formatNxc(tx.amount, 6)}
							</td>
							<td data-label="Fee" className="num">
								<Unit>{formatNumber(tx.fee)}</Unit>
							</td>
							<td data-label="Age" title={formatDateTime(tx.timestamp)}>
								{timeAgo(tx.timestamp)}
							</td>
							<td data-label="Status">
								<TxStatus status={tx.status} />
							</td>
							{showBlock ? (
								<td data-label="Block" className="num">
									{tx.metadata ? (
										<Link
											className="link mono"
											to={`/block/${tx.metadata.blockHeight}`}
										>
											#{tx.metadata.blockHeight}
										</Link>
									) : (
										<span className="muted">—</span>
									)}
								</td>
							) : null}
						</tr>
					))}
				</tbody>
			</table>
			<p className="scroll-hint">Scroll sideways to see every column →</p>
		</div>
	)
}
