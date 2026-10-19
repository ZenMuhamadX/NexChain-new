import { useEffect, useState } from 'react'
import { fetchHistory } from '../lib/rpc'
import type { HistoryRow } from '../lib/rpc'
import { formatTime, shortHash, errorMessage } from '../lib/format'
import {
	explorerMempoolUrl,
	explorerTxUrl,
	getExplorerUrl,
} from '../lib/explorerUrl'
import { bumpPendingFee } from '../lib/sendFlow'
import { Icon } from '../ui/Icon'
import { AmountDisplay } from '../ui/AmountDisplay'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'
import type { Tab } from '../types'

const ExplorerHash = ({
	hash,
	pending,
}: {
	hash: string
	pending: boolean
}): React.JSX.Element => {
	const base = getExplorerUrl()
	const href = pending ? explorerMempoolUrl(base) : explorerTxUrl(hash, base)
	const content = (
		<>
			<span>{shortHash(hash)}</span>
			{href ? <Icon name="arrowUpRight" size={12} aria-hidden="true" /> : null}
		</>
	)
	if (!href) {
		return <span className="hash-text">{shortHash(hash)}</span>
	}
	return (
		<a
			className="hash-link"
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			title={pending ? 'Open mempool in Explorer' : `Track transaction ${hash}`}
			aria-label={
				pending ? 'Open mempool in Explorer' : `Track transaction ${hash}`
			}
		>
			{content}
		</a>
	)
}

export const History = ({
	address,
	privateKey,
	onSent,
	setTab,
}: {
	address: string
	privateKey: string
	onSent: () => void
	setTab?: (tab: Tab) => void
}): React.JSX.Element => {
	const [rows, setRows] = useState<HistoryRow[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	/** Baris yang sedang dipercepat (dialog terbuka) + status kirimnya. */
	const [bumpTarget, setBumpTarget] = useState<HistoryRow | null>(null)
	const [bumpBusy, setBumpBusy] = useState(false)
	/** Hasil percepatan terakhir — sukses atau pesan tolak node/klien. */
	const [bumpResult, setBumpResult] = useState<{
		ok: boolean
		text: string
	} | null>(null)

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

	useEffect(() => {
		void load()
	}, [address])

	/**
	 * Percepat = kirim ulang tx yang sama (nonce sama) dengan fee × 2. Node
	 * menolak bila laju-fee pengganti tidak lebih tinggi; kegagalan lain
	 * (mis. saldo tidak cukup untuk amount + fee) muncul apa adanya sebagai
	 * pesan. A4b: fee di atas nilai transaksi BUKAN lagi alasan penolakan.
	 */
	const confirmBump = async (): Promise<void> => {
		if (!bumpTarget) return
		setBumpBusy(true)
		try {
			const outcome = await bumpPendingFee(bumpTarget.tx, address, privateKey)
			setBumpResult(
				outcome.ok
					? { ok: true, text: 'Pengganti dikirim. Transaksi lama digantikan.' }
					: { ok: false, text: outcome.error ?? 'Node menolak pengganti.' },
			)
			if (outcome.ok) {
				setBumpTarget(null)
				await load()
				onSent()
			}
		} catch (e) {
			setBumpResult({ ok: false, text: errorMessage(e) })
		} finally {
			setBumpBusy(false)
		}
	}

	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<p className="eyebrow">AKTIVITAS TRANSAKSI</p>
					<h1>Riwayat</h1>
					<p>Tinjau transaksi terkonfirmasi dan tertunda dari alamat ini.</p>
				</div>
				<button
					type="button"
					className="button button--secondary"
					onClick={() => void load()}
					disabled={loading}
				>
					<Icon name="refresh" size={15} aria-hidden="true" />
					{loading ? 'Memuat…' : 'Segarkan'}
				</button>
			</div>

			{error ? <Notice variant="error">{error}</Notice> : null}

			{bumpResult ? (
				<Notice
					variant={bumpResult.ok ? 'ok' : 'error'}
					onDismiss={() => setBumpResult(null)}
				>
					{bumpResult.text}
				</Notice>
			) : null}

			<section className="card table-card">
				{loading ? (
					<div className="loading-state loading-state--inline">
						<span className="spinner spinner--sm" /> Loading activity…
					</div>
				) : rows.length === 0 ? (
					<div className="empty-state">
						<span className="empty-state__icon">
							<Icon name="clock" size={22} aria-hidden="true" />
						</span>
						<h2>Belum ada transaksi</h2>
						<p>Transaksi terkonfirmasi dan tertunda akan muncul di sini.</p>
						{setTab ? (
							<div className="quick-actions">
								<button
									type="button"
									className="button button--primary"
									onClick={() => setTab('kirim')}
								>
									Kirim NXC
								</button>
								<button
									type="button"
									className="button button--secondary"
									onClick={() => setTab('terima')}
								>
									Terima NXC
								</button>
							</div>
						) : null}
					</div>
				) : (
					<>
						<div className="table-wrap">
							<table className="data-table">
								<caption className="sr-only">Riwayat transaksi wallet</caption>
								<thead>
									<tr>
										<th scope="col">Transaksi</th>
										<th scope="col">Arah</th>
										<th scope="col">Jumlah</th>
										<th scope="col">Biaya</th>
										<th scope="col">Waktu</th>
										<th scope="col">Status</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((row) => {
										const outgoing = row.tx.from === address
										const hash = row.tx.txHash ?? ''
										return (
											<tr key={hash || row.tx.receiver}>
												<td data-label="Transaksi">
													<div className="hash-cell">
														{hash ? (
															<ExplorerHash hash={hash} pending={row.pending} />
														) : (
															<span className="muted">—</span>
														)}
														{hash ? (
															<CopyButton
																text={hash}
																ariaLabel="Copy transaction hash"
																variant="plain"
															/>
														) : null}
													</div>
													<p className="input-hint">nonce #{row.tx.nonce}</p>
												</td>
												<td data-label="Arah">
													<span
														className={`direction direction--${outgoing ? 'out' : 'in'}`}
													>
														<Icon
															name={outgoing ? 'arrowUpRight' : 'arrowDownLeft'}
															size={13}
															aria-hidden="true"
														/>
														{outgoing ? 'Dikirim' : 'Diterima'}
													</span>
												</td>
												<td data-label="Jumlah" className="amount-cell">
													<AmountDisplay
														nexu={outgoing ? -row.tx.amount : row.tx.amount}
														size="table"
														detailLabel="⋯"
														ariaLabel="Lihat detail jumlah transaksi"
													/>
												</td>
												<td data-label="Biaya" className="muted-cell">
													<AmountDisplay
														nexu={row.tx.fee}
														size="table"
														detailLabel="⋯"
														ariaLabel="Lihat detail biaya transaksi"
													/>
												</td>
												<td data-label="Waktu" className="muted-cell">
													{row.tx.metadata?.blockTimestamp
														? formatTime(row.tx.metadata.blockTimestamp)
														: '—'}
												</td>
												<td data-label="Status">
													<span
														className={`badge ${row.pending ? 'badge--pending' : 'badge--confirmed'}`}
													>
														<span className="status-dot" />
														{row.pending ? 'Tertunda' : 'Terkonfirmasi'}
													</span>
													{row.pending && outgoing ? (
														<button
															type="button"
															className="button button--sm button--secondary"
															onClick={() => {
																setBumpResult(null)
																setBumpTarget(row)
															}}
														>
															Percepat
														</button>
													) : null}
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
						<p className="table-hint">
							<Icon name="arrowUpRight" size={13} aria-hidden="true" /> Hash
							terkonfirmasi membuka NexChain Explorer di tab baru.
						</p>
					</>
				)}
			</section>

			<Modal
				open={bumpTarget !== null}
				onClose={() => {
					if (!bumpBusy) setBumpTarget(null)
				}}
				title="Percepat transaksi"
				confirmLabel="Percepat"
				confirmLoading={bumpBusy}
				onConfirm={() => void confirmBump()}
			>
				<div className="review-list">
					<div>
						<span>Penerima</span>
						<strong className="mono">{bumpTarget?.tx.receiver}</strong>
					</div>
					<div>
						<span>Nonce</span>
						<strong>#{bumpTarget?.tx.nonce}</strong>
					</div>
					<div>
						<span>Biaya lama</span>
						<strong>
							<AmountDisplay
								nexu={bumpTarget?.tx.fee ?? 0}
								size="inline"
								detailLabel="Rincian"
								ariaLabel="Lihat detail biaya lama"
							/>
						</strong>
					</div>
					<div>
						<span>Biaya baru</span>
						<strong>
							<AmountDisplay
								nexu={(bumpTarget?.tx.fee ?? 0) * 2}
								size="inline"
								detailLabel="Rincian"
								ariaLabel="Lihat detail biaya baru"
							/>
						</strong>
					</div>
				</div>
				<Notice variant="warn">
					Pengganti memakai nonce yang sama, jadi transaksi lama digantikan —
					bukan ditambah. Ditolak bila laju biaya pengganti tidak lebih tinggi.
				</Notice>
			</Modal>
		</div>
	)
}
