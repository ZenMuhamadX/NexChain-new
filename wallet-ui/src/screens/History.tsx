import { useEffect, useState } from 'react'
import { fetchHistory } from '../lib/rpc'
import type { HistoryRow } from '../lib/rpc'
import { formatNxc, formatTime, shortHash, errorMessage } from '../lib/format'
import { Icon } from '../ui/Icon'
import type { Tab } from '../types'

/**
 * Tab Riwayat — menggabungkan transaksi terkonfirmasi + mempool (Bug A/B era
 * fix: mempool harus ikut tampil agar user melihat kiriman yang belum masuk
 * blok).
 */
export const History = ({ address, setTab }: { address: string; setTab: (t: Tab) => void }): React.JSX.Element => {
	const [rows, setRows] = useState<HistoryRow[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	const load = async (): Promise<void> => {
		setLoading(true)
		setError('')
		try {
			setRows(await fetchHistory(address))
		} catch (e) {
			setError(errorMessage(e))
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => { void load() }, [address])

	return (
		<section className="card">
			<div className="card-head">
				<h2>Riwayat</h2>
				<button className="ghost" onClick={() => void load()} disabled={loading}>
					<Icon name="refresh" size={14} />
					{loading ? 'Memuat…' : 'Segarkan'}
				</button>
			</div>
			{error ? <p className="error">{error}</p> : null}
			{loading ? (
				<p className="muted small">Memuat…</p>
			) : rows.length === 0 ? (
				<div className="empty">
					<span className="empty-icon">
						<Icon name="clock" size={20} />
					</span>
					<p>Belum ada transaksi.</p>
					<button className="ghost" onClick={() => setTab('kirim')}>Kirim NXC</button>
				</div>
			) : (
				<ul className="history">
					{rows.map((row) => (
						<li key={row.tx.txHash ?? `${row.tx.timestamp}-${row.tx.receiver}`}>
							<div className="tx">
								<span className={row.tx.sender === address ? 'tx-icon out' : 'tx-icon in'}>
									<Icon name={row.tx.sender === address ? 'arrowUpRight' : 'arrowDownLeft'} size={15} />
								</span>
								<div className="tx-main">
									<span className="mono tx-hash">{shortHash(row.tx.txHash ?? '')}</span>
									<span className="hint">{formatTime(row.tx.timestamp)} · fee {row.tx.fee} nexu</span>
								</div>
								<div className="tx-side">
									<span className="mono amount">
										{row.tx.sender === address ? '−' : '+'}
										{formatNxc(row.tx.amount)} NXC
									</span>
									<span className={row.pending ? 'badge pending' : 'badge confirmed'}>
										{row.pending ? 'mempool' : 'konfirmasi'}
									</span>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
