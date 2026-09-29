import { useCallback, useEffect, useState } from 'react'
import { fetchHistory } from '../lib/rpc'
import type { HistoryRow } from '../lib/rpc'
import { formatTime, shortHash, errorMessage } from '../lib/format'
import { explorerMempoolUrl, explorerTxUrl, getExplorerUrl } from '../lib/explorerUrl'
import { Icon } from '../ui/Icon'
import { AmountDisplay } from '../ui/AmountDisplay'
import { CopyButton } from '../ui/CopyButton'
import { Notice } from '../ui/Notice'
import { useIsPopup, openWalletTab } from '../lib/surface'
import type { Tab } from '../types'

/**
 * Riwayat transaksi.
 *
 * BENTUK: daftar baris (bukan <table>). Tabel 6 kolom dari wallet-ui butuh
 * ~700px; memaksanya masuk 360px hanya menghasilkan gulir horizontal dan
 * header yang tidak pernah terlihat. Daftar baris menaruh informasi penting
 * (arah, jumlah, waktu) di kolom vertikal yang terbaca tanpa gulir samping.
 *
 * Hash tetap dapat diklik ke explorer; tombol salin per baris dihilangkan
 * karena baris itu sendiri bisa diklik — menyalin hash tersedia di explorer.
 */
export const History = ({
	address,
	setTab,
}: {
	address: string
	setTab?: (tab: Tab) => void
}): React.JSX.Element => {
	const [rows, setRows] = useState<HistoryRow[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [tabError, setTabError] = useState('')
	const isPopup = useIsPopup()

	const load = useCallback(async (): Promise<void> => {
		setLoading(true)
		setError('')
		try {
			setRows(await fetchHistory(address))
		} catch (e) {
			setError(errorMessage(e))
		} finally {
			setLoading(false)
		}
	}, [address])

	useEffect(() => {
		void load()
	}, [load])

	const openInTab = async (): Promise<void> => {
		const message = await openWalletTab()
		setTabError(message ?? '')
	}

	return (
		<div className="page-stack">
			<div className="page-head">
				<div>
					<h1>Riwayat</h1>
					<p className="page-head__sub">Transaksi terkonfirmasi dan tertunda.</p>
				</div>
				<button
					type="button"
					className="icon-button icon-button--sm"
					onClick={() => void load()}
					disabled={loading}
					title="Segarkan riwayat"
					aria-label="Segarkan riwayat"
				>
					<Icon name="refresh" size={15} aria-hidden="true" />
				</button>
			</div>

			{/* Di popup, tabel panjang lebih nyaman di tab penuh. */}
			{isPopup ? (
				<button type="button" className="hint-card" onClick={() => void openInTab()}>
					<span className="hint-card__icon" aria-hidden="true">
						<Icon name="arrowUpRight" size={15} />
					</span>
					<span className="hint-card__text">
						<strong>Butuh tampilan lebih lega?</strong>
						<span>Buka riwayat di tab penuh untuk daftar yang lebih panjang.</span>
					</span>
					<Icon name="arrowUpRight" size={14} aria-hidden="true" />
				</button>
			) : null}
			{tabError ? <Notice variant="error">{tabError}</Notice> : null}

			{error ? <Notice variant="error">{error}</Notice> : null}

			<section className="card">
				{loading ? (
					<div className="loading-state loading-state--block">
						<span className="spinner" aria-hidden="true" />
						<span>Memuat aktivitas…</span>
					</div>
				) : rows.length === 0 ? (
					<div className="empty-state">
						<span className="empty-state__icon" aria-hidden="true">
							<Icon name="clock" size={20} />
						</span>
						<h2>Belum ada transaksi</h2>
						<p>Transaksi terkonfirmasi dan tertunda akan muncul di sini.</p>
						{setTab ? (
							<button
								type="button"
								className="button button--primary"
								onClick={() => setTab('kirim')}
							>
								Kirim NXC
							</button>
						) : null}
					</div>
				) : (
					<ul className="tx-list">
						{rows.map((row) => {
							const outgoing = row.tx.sender === address
							const hash = row.tx.txHash ?? ''
							const base = getExplorerUrl()
							const href = row.pending
								? explorerMempoolUrl(base)
								: hash
									? explorerTxUrl(hash, base)
									: ''
							const counterparty = outgoing ? row.tx.receiver : row.tx.sender

							const inner = (
								<>
									<span
										className={`tx-row__icon tx-row__icon--${outgoing ? 'out' : 'in'}`}
										aria-hidden="true"
									>
										<Icon
											name={outgoing ? 'arrowUpRight' : 'arrowDownLeft'}
											size={15}
										/>
									</span>
									<span className="tx-row__body">
										<span className="tx-row__title">
											{outgoing ? 'Dikirim' : 'Diterima'}
											<span
												className={`badge ${
													row.pending ? 'badge--pending' : 'badge--confirmed'
												}`}
											>
												<span className="status-dot" />
												{row.pending ? 'Tertunda' : 'Selesai'}
											</span>
										</span>
										<span className="tx-row__meta">
											{counterparty
												? `${outgoing ? 'Ke' : 'Dari'} ${shortHash(counterparty)}`
												: shortHash(hash)}
										</span>
										<span className="tx-row__meta">
											{formatTime(row.tx.timestamp)}
											{row.tx.extraMessage ? ` · ${row.tx.extraMessage}` : ''}
										</span>
									</span>
									<span className="tx-row__amount">
										<AmountDisplay
											nexu={outgoing ? -row.tx.amount : row.tx.amount}
											size="table"
											detailLabel="⋯"
											ariaLabel="Lihat detail jumlah transaksi"
										/>
									</span>
								</>
							)

							return (
								<li key={hash || `${row.tx.timestamp}-${row.tx.receiver}`}>
									{href ? (
										<a
											className="tx-row"
											href={href}
											target="_blank"
											rel="noopener noreferrer"
											title={
												row.pending
													? 'Buka mempool di Explorer'
													: `Lacak transaksi ${hash}`
											}
										>
											{inner}
										</a>
									) : (
										<div className="tx-row">{inner}</div>
									)}
								</li>
							)
						})}
					</ul>
				)}
			</section>

			{rows.length > 0 ? (
				<>
					<p className="input-hint">
						<Icon name="arrowUpRight" size={12} aria-hidden="true" /> Ketuk baris untuk
						membuka di Explorer.
					</p>
					{hashOfFirst(rows) ? (
						<div className="copy-row">
							<span className="input-hint">Salin hash teratas</span>
							<CopyButton
								text={hashOfFirst(rows) ?? ''}
								ariaLabel="Salin hash transaksi teratas"
								variant="secondary"
								size={13}
							>
								Salin hash
							</CopyButton>
						</div>
					) : null}
				</>
			) : null}
		</div>
	)
}

const hashOfFirst = (rows: HistoryRow[]): string | undefined => {
	for (const row of rows) {
		if (typeof row.tx.txHash === 'string' && row.tx.txHash) return row.tx.txHash
	}
	return undefined
}
