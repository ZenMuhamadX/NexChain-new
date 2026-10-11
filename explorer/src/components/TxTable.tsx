import { Link } from 'react-router-dom'
import type { HistoryEntry } from '../api/types'
import { useTimeDisplay } from '../hooks/useTimeDisplay'
import {
	formatDateTime,
	formatNxc,
	formatNumber,
	timeAgo,
	truncateMiddle,
} from '../lib/format'
import { Unit } from './common/Unit'

/**
 * Badge status transaksi — DITURUNKAN dari keanggotaan blok.
 *
 * Sebelumnya membaca field `status` di dalam transaksi, yang kini tidak ada:
 * "terkonfirmasi" bukan properti transaksi, melainkan fakta rantai (transaksi
 * ada di sebuah blok). Lihat `isTxExecuted` di node.
 */
export function TxStatus({ confirmed }: { confirmed: boolean }) {
	const status = confirmed ? 'confirmed' : 'pending'
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
	compact = false,
}: {
	transactions: (HistoryEntry | undefined)[]
	compact?: boolean
}) {
	const rows = transactions.filter((tx): tx is HistoryEntry => tx !== undefined)
	const { mode: timeMode, toggle: toggleTimeMode } = useTimeDisplay()
	if (rows.length === 0) return null

	const showBlock = !compact && rows.some((tx) => tx.metadata !== undefined)

	return (
		<div className="table-wrap">
			<table
				className={`table table-responsive${compact ? ' tx-table-compact' : ''}`}
			>
				<caption className="sr-only">
					{compact
						? 'Transactions — hash, amount, age and status'
						: 'Transactions — hash, sender, receiver, amount, fee, age and status'}
				</caption>
				<thead>
					<tr>
						<th scope="col">TxHash</th>
						{!compact ? (
							<>
								<th scope="col">From</th>
								<th scope="col">To</th>
							</>
						) : null}
						<th scope="col" className="num">
							Amount
						</th>
						{!compact ? (
							<th scope="col" className="num">
								Fee
							</th>
						) : null}
						<th scope="col" aria-sort="none">
							<button
								type="button"
								className="table-time-toggle"
								onClick={toggleTimeMode}
								aria-label={`Show ${timeMode === 'age' ? 'date and time' : 'transaction age'}`}
								title="Toggle age and date/time"
							>
								{timeMode === 'age' ? 'Age' : 'Date Time'}
							</button>
						</th>
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
						<tr key={tx.txHash ?? `${tx.sender}-${tx.receiver}-${index}`}>
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
							{!compact ? (
								<>
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
								</>
							) : null}
							<td data-label="Amount" className="num">
								{formatNxc(tx.amount, 6)}
							</td>
							{!compact ? (
								<td data-label="Fee" className="num">
									<Unit>{formatNumber(tx.fee)}</Unit>
								</td>
							) : null}
							<td
								data-label={timeMode === 'age' ? 'Age' : 'Date Time'}
								title={
									tx.metadata ? formatDateTime(tx.metadata.blockTimestamp) : ''
								}
							>
								{tx.metadata
									? timeMode === 'age'
										? timeAgo(tx.metadata.blockTimestamp)
										: formatDateTime(tx.metadata.blockTimestamp)
									: '—'}
							</td>
							<td data-label="Status">
								<TxStatus confirmed={tx.metadata !== undefined} />
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
