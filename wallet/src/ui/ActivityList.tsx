import { useCallback, useEffect, useRef, useState } from 'react'
import { ACTIVITY_PAGE_SIZE, fetchActivityPage } from '../lib/rpc'
import type { HistoryRow } from '../lib/rpc'
import {
	errorMessage,
	formatNxcCompact,
	formatNxcExact,
	formatTime,
	truncate,
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
	/** Naik setiap transaksi terkirim → daftar dimuat ulang. */
	version: number
	/**
	 * Naik saat saldo/pending di latar berubah (mis. tx terkonfirmasi).
	 *
	 * Beda peran dengan `version`: `version` berasal dari aksi pengguna dan
	 * mengembalikan daftar ke halaman 1 (transaksi baru ada di atas), sedangkan
	 * `liveVersion` hanya menyegarkan halaman yang sedang dibaca — pengguna
	 * tidak boleh terlempar dari halaman 3 karena sebuah tx kebetulan masuk blok.
	 */
	liveVersion: number
	/** Ada perubahan di luar alur kirim (mis. percepat) → saldo ikut disegarkan. */
	onChanged: () => void
	/** Baris per halaman. Beranda memakai 5 sebagai pratinjau. */
	pageSize?: number
	/**
	 * Ada = mode pratinjau: daftar dibatasi satu halaman dan diganti tautan
	 * "Lihat semua". Tanpa prop ini daftar memakai navigasi halaman penuh.
	 */
	onViewAll?: () => void
}

/**
 * Kunci baris yang stabil: hash tx bila ada, selain itu from+nonce.
 *
 * Dipakai untuk `key` daftar DAN untuk melacak baris mana yang sedang dibuka
 * di modal detail. Sebelumnya modal menyimpan OBJEK baris, jadi saat daftar
 * dimuat ulang modal tetap menampilkan salinan lama — "Tertunda" bertahan
 * walau transaksinya sudah masuk blok.
 */
const rowKey = (row: HistoryRow): string =>
	row.tx.txHash || `${row.tx.from ?? ''}-${row.tx.nonce}`

/**
 * Daftar aktivitas, dua mode dalam satu komponen:
 *
 * - **Pratinjau (Beranda)**: satu halaman kecil + tautan ke layar Riwayat.
 * - **Penuh (Riwayat)**: tombol Sebelumnya/Selanjutnya memakai `totalPages`
 *   dari node, jadi tidak pernah ada satu halaman berisi seluruh riwayat.
 *
 * Nomor halaman (bukan "muat lebih banyak") karena node sudah menghitung
 * `count`/`totalPages`; menambah baris ke bawah membuat halaman jadi tak
 * berujung dan pengguna kehilangan posisi.
 */
export const ActivityList = ({
	address,
	privateKey,
	version,
	liveVersion,
	onChanged,
	pageSize = ACTIVITY_PAGE_SIZE,
	onViewAll,
}: ActivityListProps): React.JSX.Element => {
	const [rows, setRows] = useState<HistoryRow[]>([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(1)
	const [totalPages, setTotalPages] = useState(1)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	/** Kunci baris yang sedang dibuka di modal detail. */
	const [detailKey, setDetailKey] = useState('')
	/** Cadangan bila baris itu tidak lagi ada di halaman yang dimuat. */
	const [detailSnapshot, setDetailSnapshot] = useState<HistoryRow | null>(null)
	const [bumpTarget, setBumpTarget] = useState<HistoryRow | null>(null)
	const [bumpBusy, setBumpBusy] = useState(false)
	const [bumpResult, setBumpResult] = useState<{
		ok: boolean
		text: string
	} | null>(null)

	/** Halaman aktif tanpa memasukkan `page` ke dependency penyegaran latar. */
	const pageRef = useRef(page)
	pageRef.current = page

	const load = useCallback(
		async (target: number, options?: { silent?: boolean }): Promise<void> => {
			const silent = options?.silent === true
			if (!silent) {
				setError('')
				setLoading(true)
			}
			try {
				const next = await fetchActivityPage(address, target, pageSize)
				setRows(next.rows)
				setTotal(next.total)
				setTotalPages(Math.max(1, next.totalPages))
				setPage(next.page)
				if (silent) setError('')
			} catch (e) {
				/*
				 * Penyegaran latar TIDAK boleh mengosongkan daftar. Gangguan
				 * sesaat pada satu request latar bukan alasan menyatakan
				 * "riwayat tidak dapat dimuat" — saldo di atasnya pun masih
				 * menampilkan angka terakhir. Diamkan, biarkan poll berikutnya
				 * mencoba lagi.
				 */
				if (silent) return
				// Daftar halaman lain tidak boleh tertinggal di bawah nomor halaman
				// yang gagal dimuat — kosongkan dan tampilkan error.
				setRows([])
				setError(errorMessage(e))
			} finally {
				if (!silent) setLoading(false)
			}
		},
		[address, pageSize],
	)

	/** Transaksi baru masuk → kembali ke halaman pertama. */
	useEffect(() => {
		void load(1)
	}, [load, version])

	/**
	 * Penyegaran latar: halaman yang sedang dibuka, tanpa spinner dan tanpa
	 * memindahkan posisi baca. Dipicu `liveVersion` dari App saat saldo atau
	 * pending berubah — satu-satunya cara riwayat ikut bergerak dari
	 * "Tertunda" ke "Terkonfirmasi" tanpa pengguna menyegarkan halaman.
	 */
	useEffect(() => {
		if (liveVersion === 0) return
		void load(pageRef.current, { silent: true })
	}, [liveVersion, load])

	const goTo = (target: number): void => {
		if (target < 1 || target > totalPages || target === page) return
		void load(target)
		window.scrollTo({ top: 0 })
	}

	const runBump = async (): Promise<void> => {
		if (!bumpTarget) return
		setBumpBusy(true)
		try {
			const outcome = await bumpPendingFee(bumpTarget.tx, address, privateKey)
			if (outcome.ok) {
				setBumpTarget(null)
				await load(page)
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

	/**
	 * Baris detail DITURUNKAN dari daftar yang sedang tampil, bukan disimpan
	 * sebagai salinan. Inilah yang membuat modal yang sedang terbuka ikut
	 * berubah dari "Tertunda" ke "Terkonfirmasi" saat daftar disegarkan di
	 * latar. `detailSnapshot` hanya jaring pengaman kalau barisnya keluar dari
	 * halaman (mis. pengguna pindah halaman) — modal tidak boleh mengedip
	 * kosong di tengah pembacaan.
	 */
	const detail =
		detailKey === ''
			? null
			: (rows.find((row) => rowKey(row) === detailKey) ?? detailSnapshot)

	const closeDetail = (): void => {
		setDetailKey('')
		setDetailSnapshot(null)
	}

	const openDetail = (row: HistoryRow): void => {
		setDetailSnapshot(row)
		setDetailKey(rowKey(row))
	}

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
			) : error ? (
				/*
				 * Gagal memuat TIDAK boleh tampil sebagai "Belum ada transaksi" —
				 * daftar kosong karena node mati/salah URL bukan pernyataan bahwa
				 * alamat ini belum pernah bertransaksi.
				 */
				<div className="empty-state" role="alert">
					<span className="empty-state__icon">
						<Icon name="refresh" size={22} aria-hidden="true" />
					</span>
					<p>
						Riwayat tidak dapat dimuat dari node ini. Periksa URL node di
						Pengaturan, lalu coba lagi.
					</p>
					<p className="empty-state__detail mono">{error}</p>
					<button
						type="button"
						className="button button--secondary"
						onClick={() => void load(page)}
					>
						Coba lagi
					</button>
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
							return (
								<li key={rowKey(row)}>
									<button
										type="button"
										className="tx-row"
										onClick={() => openDetail(row)}
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

					{onViewAll ? (
						confirmedShown < total ? (
							<button
								type="button"
								className="button button--secondary button--wide load-more"
								onClick={onViewAll}
							>
								Lihat semua ({total})
								<Icon name="arrowRight" size={14} aria-hidden="true" />
							</button>
						) : null
					) : totalPages > 1 ? (
						<nav className="pagination" aria-label="Halaman riwayat">
							<button
								type="button"
								className="button button--secondary button--sm"
								onClick={() => goTo(page - 1)}
								disabled={page <= 1}
							>
								<Icon name="arrowLeft" size={14} aria-hidden="true" />
								Sebelumnya
							</button>
							<span className="pagination__label">
								Halaman {page} dari {totalPages}
							</span>
							<button
								type="button"
								className="button button--secondary button--sm"
								onClick={() => goTo(page + 1)}
								disabled={page >= totalPages}
							>
								Selanjutnya
								<Icon name="arrowRight" size={14} aria-hidden="true" />
							</button>
						</nav>
					) : null}
				</>
			)}

			<Modal
				open={detail !== null}
				onClose={closeDetail}
				size="sm"
				title="Detail transaksi"
				actions={
					<div className="modal-actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={closeDetail}
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
									closeDetail()
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
						{detail.tx.from ? (
							<div>
								<span>Pengirim</span>
								<div className="review-value">
									<strong className="mono tx-hash">{detail.tx.from}</strong>
									<CopyButton
										text={detail.tx.from}
										ariaLabel="Salin alamat pengirim"
										variant="plain"
									/>
								</div>
							</div>
						) : null}
						{detail.tx.receiver ? (
							<div>
								<span>Penerima</span>
								<div className="review-value">
									<strong className="mono tx-hash">{detail.tx.receiver}</strong>
									<CopyButton
										text={detail.tx.receiver}
										ariaLabel="Salin alamat penerima"
										variant="plain"
									/>
								</div>
							</div>
						) : null}
						{/*
						 * "ID Transaksi", bukan "Hash": hash-nya memang ID, tapi
						 * label "Hash" membuat orang mengira itu checksum yang
						 * tidak ada hubungannya dengan transaksi ini.
						 * Nilainya dipotong di tengah — 43 karakter penuh terlipat
						 * jadi tiga baris di modal selebar ini — sementara tombol
						 * salin dan `title` tetap membawa nilai utuh.
						 */}
						{detailHash ? (
							<div>
								<span>ID Transaksi</span>
								<div className="review-value">
									<strong className="mono" title={detailHash}>
										{truncate(detailHash)}
									</strong>
									<CopyButton
										text={detailHash}
										ariaLabel="Salin ID transaksi"
										variant="plain"
									/>
								</div>
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
