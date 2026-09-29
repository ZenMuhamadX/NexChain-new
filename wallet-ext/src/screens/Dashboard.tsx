import { Icon } from '../ui/Icon'
import { AmountDisplay } from '../ui/AmountDisplay'
import { AddressText } from '../ui/AddressText'
import { CopyButton } from '../ui/CopyButton'
import type { Tab } from '../types'

interface DashboardProps {
	address: string
	balance: number
	pending: number
	nonce: number
	chainId?: number
	loading: boolean
	/** Label status node dari App (sudah memperhitungkan error/loading). */
	networkLabel: string
	refresh: () => void
	setTab: (tab: Tab) => void
}

export const Dashboard = ({
	address,
	balance,
	pending,
	nonce,
	chainId,
	loading,
	networkLabel,
	refresh,
	setTab,
}: DashboardProps): React.JSX.Element => {
	/**
	 * Saldo yang benar-benar bisa dibelanjakan.
	 *
	 * `Math.max(0, …)` penting: pending bisa melebihi balance sesaat setelah
	 * transaksi masuk (saldo belum turun, mempool sudah menahan dana). Tanpa
	 * penjepit itu kita menampilkan angka negatif ke pengguna.
	 */
	const available = Math.max(0, balance - pending)

	return (
		<div className="page-stack">
			{/* --- Kartu saldo: elemen utama popup --- */}
			<section className="card balance-card">
				<div className="balance-card__head">
					<span className="eyebrow">Total saldo</span>
					<button
						type="button"
						className="icon-button icon-button--sm"
						onClick={refresh}
						disabled={loading}
						title="Segarkan saldo"
						aria-label="Segarkan saldo"
					>
						<Icon name="refresh" size={15} aria-hidden="true" />
					</button>
				</div>

				<div className="balance-display">
					<AmountDisplay
						nexu={balance}
						size="large"
						ariaLabel="Lihat detail saldo"
					/>
				</div>

				{pending !== 0 ? (
					<p className="balance-alert">
						<Icon name="clock" size={13} aria-hidden="true" />
						<span>
							<AmountDisplay
								nexu={pending}
								size="inline"
								showUnit={false}
								detailLabel="Rincian"
								ariaLabel="Lihat detail saldo tertunda"
							/>{' '}
							menunggu di mempool
						</span>
					</p>
				) : null}

				<div className="quick-actions">
					<button
						type="button"
						className="button button--primary button--wide"
						onClick={() => setTab('kirim')}
					>
						<Icon name="arrowUpRight" size={16} aria-hidden="true" /> Kirim
					</button>
					<button
						type="button"
						className="button button--secondary button--wide"
						onClick={() => setTab('terima')}
					>
						<Icon name="arrowDownLeft" size={16} aria-hidden="true" /> Terima
					</button>
				</div>
			</section>

			{/* --- Alamat --- */}
			<section className="card address-card">
				<div className="card-title">
					<span className="eyebrow">Alamat wallet</span>
					<CopyButton
						text={address}
						ariaLabel="Salin alamat wallet"
						variant="secondary"
						size={14}
					>
						Salin
					</CopyButton>
				</div>
				<div className="address-panel">
					<AddressText address={address} head={10} tail={8} />
				</div>
			</section>

			{/* --- Ringkasan akun ---
			    Empat kolom di desktop (wallet-ui) mustahil di 360px; di sini
			    grid 2x2 dengan label kecil. */}
			<section className="card stat-grid">
				<div className="stat-item">
					<span className="stat-label">Tersedia</span>
					<strong>
						<AmountDisplay
							nexu={available}
							size="table"
							detailLabel="⋯"
							ariaLabel="Lihat detail saldo tersedia"
						/>
					</strong>
					<small>Saldo dikurangi pending</small>
				</div>
				<div className="stat-item">
					<span className="stat-label">Nonce berikutnya</span>
					<strong>{nonce}</strong>
					<small>Untuk transaksi berikut</small>
				</div>
				<div className="stat-item">
					<span className="stat-label">Chain ID</span>
					<strong>{chainId ?? '—'}</strong>
					<small>Jaringan NexChain</small>
				</div>
				<div className="stat-item">
					<span className="stat-label">Status node</span>
					<strong className="status-value">
						<span
							className={`status-dot ${
								loading ? 'status-dot--warning' : 'status-dot--success'
							}`}
						/>
						{networkLabel}
					</strong>
					<small>Diperbarui otomatis</small>
				</div>
			</section>

			<button
				type="button"
				className="hint-card"
				onClick={() => setTab('pengaturan')}
			>
				<span className="hint-card__icon" aria-hidden="true">
					<Icon name="lock" size={15} />
				</span>
				<span className="hint-card__text">
					<strong>Amankan frasa pemulihan Anda</strong>
					<span>Simpan offline, dan kunci wallet saat meninggalkan perangkat.</span>
				</span>
				<Icon name="arrowUpRight" size={14} aria-hidden="true" />
			</button>
		</div>
	)
}
