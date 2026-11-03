import { useCallback, useEffect, useState } from 'react'
import { ACTIVITY_PAGE_SIZE, fetchActivityPage } from '../lib/rpc'
import type { HistoryRow } from '../lib/rpc'
import {
	errorMessage,
	formatNxcCompact,
	formatNxcExact,
	formatTime,
} from '../lib/format'
import { bumpPendingFee } from '../lib/sendFlow'
import {
	explorerMempoolUrl,
	explorerTxUrl,
	getExplorerUrl,
} from '../lib/explorerUrl'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'

interface ActivityListProps {
	address: string
	privateKey: string
	/** Naik setiap transaksi terkirim → halaman pertama dimuat ulang. */
	version: number
	onSend: () => void
	onReceive: () => void
	/** Ada perubahan di luar alur kirim (mis. percepat) → saldo ikut disegarkan. */
	onChanged: () => void
}

/**
 * Daftar aktivitas Beranda: satu baris per transaksi, tumbuh lewat "Muat lebih
 * banyak" — bukan nomor halaman.
 *
 * MENGAPA muat-lebih-banyak: nomor halaman memaksa node menghitung total tiap
 * permintaan dan membuat pengguna kehilangan posisi saat daftar bertambah di
 * atas. Penambahan halaman berikutnya di-dedup per `txHash` karena transaksi
 * baru bisa masuk di antara dua permintaan dan menggeser offset.
 */
export const ActivityList = ({
	address,
	privateKey,
	version,
	onSend,
	onReceive,
	onChanged,
}: ActivityListProps): React.JSX.Element => {
	const [rows, setRows] = useState<HistoryRow[]>([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(1)
	/** true hanya sebelum jawaban PERTAMA — "muat lebih banyak" tidak mengedipkan daftar. */
	const [loading, setLoading] = useState(true)
	const [loadingMore, setLoadingMore] = useState(false)
	const [error, setError] = useState('')
	const [detail, setDetail] = useState<HistoryRow | null>(null)
	const [bumpTarget, setBumpTarget] = useState<HistoryRow | null>(null)
	const [bumpBusy, setBumpBusy] = useState(false)
	const [bumpResult, setBumpResult] = useState<{
		ok: boolean
		text: string
	} | null>(null)

	const loadFirst = useCallback(async (): Promise<void> => {
		setError('')
		try {
			const first = await fetchActivityPage(address, 1, ACTIVITY_PAGE_SIZE)
			setRows(first.rows)
			setTotal(first.total)
			setPage(1)
		} catch (e) {
			setError(errorMessage(e))
		} finally {
			setLoading(false)
		}
	}, [address])

	useEffect(() => {
		void loadFirst()
	}, [loadFirst, version])

	const loadMore = async (): Promise<void> => {
		setLoadingMore(true)
		setError('')
		try {
			const next = await fetchActivityPage(
				address,
				page + 1,
				ACTIVITY_PAGE_SIZE,
			)
			setPage(page + 1)
			setTotal(next.total)
			setRows((previous) => {
				const seen = new Set(previous.map((row) => row.tx.txHash))
				return [
					...previous,
					...next.rows.filter(
						(row) => !row.tx.txHash || !seen.has(row.tx.txHash),
					),
				]
			})
		} catch (e) {
			setError(errorMessage(e))
		} finally {
			setLoadingMore(false)
		}
	}

	const runBump = async (): Promise<void> => {
		if (!bumpTarget) return
		setBumpBusy(true)
		try {
			const outcome = await bumpPendingFee(bumpTarget.tx, address, privateKey)
			if (outcome.ok) {
				setBumpTarget(null)
				await loadFirst()
				onChanged()
			}
			setBumpResult(
				outcome.ok
					? { ok: true, text: 'Pengganti dikirim. Transaksi lama digantikan.' }
					: { ok: false, text: outcome.error ?? 'Node menolak pengganti.' },
			)
		} catch (e) {
			setBumpResult({ ok: false, text: errorMessage(e) })
		} finally {
			setBumpBusy(false)
		}
	}

	const confirmedShown = rows.filter((row) => !row.pending).length
	const hasMore = confirmedShown < total

	const detailOutgoing = detail !== null && detail.tx.from === address
	const detailHash = detail?.tx.txHash ?? ''
	const explorerBase = getExplorerUrl()
	const detailHref = detailHash
		? detail?.pending
			? explorerMempoolUrl(explorerBase)
			: explorerTxUrl(detailHash, explorerBase)
		: ''

	return (
		<>
			{error ? <Notice variant="error">{error}</Notice> : null}
			{bumpResult ? (
				<Notice
					variant={bumpResult.ok ? 'ok' : 'error'}
					onDismiss={() => setBumpResult(null)}
				>
					{bumpResult.text}
				</Notice>
			) : null}

			{loading ? (
				<div className="loading-state loading-state--inline">
					<span className="spinner spinner--sm" /> Memuat aktivitas…
				</div>
			) : rows.length === 0 ? (
				<div className="empty-state">
					<span className="empty-state__icon">
						<Icon name="clock" size={22} aria-hidden="true" />
					</span>
					<p>Belum ada transaksi. Kirim atau terima NXC untuk memulai.</p>
				</div>
			) : (
				<>
					<ul className="tx-list">
						{rows.map((row) => {
							const outgoing = row.tx.from === address
							const hash = row.tx.txHash ?? ''
							return (
								<li key={hash || `${row.tx.from}-${row.tx.nonce}`}>
									<button
										type="button"
										className="tx-row"
										onClick={() => setDetail(row)}
										aria-label={`${outgoing ? 'Dikirim' : 'Diterima'} ${formatNxcCompact(row.tx.amount)} NXC, buka detail`}
									>
										<span
											className={`tx-row__icon tx-row__icon--${outgoing ? 'out' : 'in'}`}
											aria-hidden="true"
										>
											<Icon
												name={outgoing ? 'arrowUpRight' : 'arrowDownLeft'}
												size={16}
											/>
										</span>
										<span className="tx-row__main">
											<strong>{outgoing ? 'Dikirim' : 'Diterima'}</strong>
											<span className="tx-row__meta">
												{row.pending
													? 'Tertunda'
													: row.tx.metadata?.blockTimestamp
														? formatTime(row.tx.metadata.blockTimestamp)
														: '—'}
											</span>
										</span>
										<span
											className={`tx-row__amount ${outgoing ? 'is-out' : 'is-in'}`}
										>
											{outgoing ? '−' : '+'}
											{formatNxcCompact(row.tx.amount)}
											<span className="tx-row__unit"> NXC</span>
										</span>
										<Icon name="arrowRight" size={14} aria-hidden="true" />
									</button>
								</li>
							)
						})}
					</ul>

					{hasMore ? (
						<button
							type="button"
							className="button button--secondary button--wide load-more"
							onClick={() => void loadMore()}
							disabled={loadingMore}
						>
							{loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
						</button>
					) : total > ACTIVITY_PAGE_SIZE ? (
						<p className="tx-list__end">Semua transaksi sudah ditampilkan.</p>
					) : null}
				</>
			)}

			<Modal
				open={detail !== null}
				onClose={() => setDetail(null)}
				size="sm"
				title="Detail transaksi"
				actions={
					<div className="modal-actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() => setDetail(null)}
						>
							Tutup
						</button>
						{detail?.pending && detailOutgoing ? (
							<button
								type="button"
								className="button button--primary"
								onClick={() => {
									setBumpResult(null)
									setBumpTarget(detail)
									setDetail(null)
								}}
							>
								Percepat
							</button>
						) : null}
					</div>
				}
			>
				{detail ? (
					<div className="review-list">
						<div>
							<span>Status</span>
							<strong>
								{detail.pending ? 'Tertunda di mempool' : 'Terkonfirmasi'}
							</strong>
						</div>
						<div>
							<span>Arah</span>
							<strong>{detailOutgoing ? 'Dikirim' : 'Diterima'}</strong>
						</div>
						<div>
							<span>Jumlah</span>
							<strong className="mono">
								{formatNxcExact(detail.tx.amount)} NXC
							</strong>
						</div>
						<div>
							<span>Biaya</span>
							<strong className="mono">
								{formatNxcExact(detail.tx.fee)} NXC
							</strong>
						</div>
						<div>
							<span>Nonce</span>
							<strong>#{detail.tx.nonce}</strong>
						</div>
						<div>
							<span>Waktu</span>
							<strong>
								{detail.pending
									? 'Menunggu blok'
									: detail.tx.metadata?.blockTimestamp
										? formatTime(detail.tx.metadata.blockTimestamp)
										: '—'}
							</strong>
						</div>
						{detail.tx.receiver ? (
							<div>
								<span>Penerima</span>
								<strong className="mono tx-hash">{detail.tx.receiver}</strong>
							</div>
						) : null}
						{detailHash ? (
							<div>
								<span>Hash</span>
								<strong className="mono tx-hash">{detailHash}</strong>
								<CopyButton
									text={detailHash}
									ariaLabel="Salin hash transaksi"
									variant="plain"
								/>
							</div>
						) : null}
					</div>
				) : null}
				{detailHref ? (
					<a
						className="text-button"
						href={detailHref}
						target="_blank"
						rel="noopener noreferrer"
					>
						Buka di Explorer{' '}
						<Icon name="arrowUpRight" size={13} aria-hidden="true" />
					</a>
				) : null}
			</Modal>

			<Modal
				open={bumpTarget !== null}
				onClose={() => {
					if (!bumpBusy) setBumpTarget(null)
				}}
				title="Percepat transaksi"
				confirmLabel="Percepat"
				confirmLoading={bumpBusy}
				onConfirm={() => void runBump()}
			>
				<div className="review-list">
					<div>
						<span>Penerima</span>
						<strong className="mono tx-hash">{bumpTarget?.tx.receiver}</strong>
					</div>
					<div>
						<span>Biaya lama</span>
						<strong className="mono">
							{formatNxcExact(bumpTarget?.tx.fee ?? 0)} NXC
						</strong>
					</div>
					<div>
						<span>Biaya baru</span>
						<strong className="mono">
							{formatNxcExact((bumpTarget?.tx.fee ?? 0) * 2)} NXC
						</strong>
					</div>
				</div>
				<Notice variant="warn">
					Pengganti memakai nonce yang sama, jadi transaksi lama digantikan —
					bukan ditambah. Ditolak bila laju biaya pengganti tidak lebih tinggi.
				</Notice>
			</Modal>
		</>
	)
}
