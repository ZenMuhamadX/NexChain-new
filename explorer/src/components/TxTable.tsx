import { Link } from 'react-router-dom'
import type { HistoryEntry } from '../api/types'
import {
	formatDateTime,
	formatNxc,
	formatNumber,
	timeAgo,
	truncateMiddle,
} from '../lib/format'

/** Badge status transaksi. */
export function TxStatus({ status }: { status: HistoryEntry['status'] }) {
	return <span className={`badge badge-${status}`}>{status}</span>
}

/**
 * Tabel transaksi umum — dipakai di detail blok, mempool, dan riwayat
 * address. Kolom "Block" hanya muncul kalau minimal satu entry punya
 * metadata blok (backend saat ini tidak selalu mengisinya).
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
			<table className="table">
				<thead>
					<tr>
						<th>TxHash</th>
						<th>From</th>
						<th>To</th>
						<th className="num">Amount</th>
						<th className="num">Fee</th>
						<th>Age</th>
						<th>Status</th>
						{showBlock ? <th className="num">Block</th> : null}
					</tr>
				</thead>
				<tbody>
					{rows.map((tx, index) => (
						<tr key={tx.txHash ?? `${tx.sender}-${tx.timestamp}-${index}`}>
							<td>
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
							<td>
								<Link
									className="link mono"
									to={`/address/${tx.sender}`}
									title={tx.sender}
								>
									{truncateMiddle(tx.sender, 8, 6)}
								</Link>
							</td>
							<td>
								<Link
									className="link mono"
									to={`/address/${tx.receiver}`}
									title={tx.receiver}
								>
									{truncateMiddle(tx.receiver, 8, 6)}
								</Link>
							</td>
							<td className="num">{formatNxc(tx.amount, 6)}</td>
							<td className="num">{formatNumber(tx.fee)} nexu</td>
							<td title={formatDateTime(tx.timestamp)}>
								{timeAgo(tx.timestamp)}
							</td>
							<td>
								<TxStatus status={tx.status} />
							</td>
							{showBlock ? (
								<td className="num">
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
		</div>
	)
}
