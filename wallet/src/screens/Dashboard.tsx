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
	networkState: 'offline' | 'connecting' | 'connected'
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
	networkState,
	refresh,
	setTab,
}: DashboardProps): React.JSX.Element => {
	const available = balance - pending
	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<p className="eyebrow">RINGKASAN PORTOFOLIO</p>
					<h1>Selamat datang kembali</h1>
					<p>Pantau saldo NexChain dan pindahkan dana dengan tenang.</p>
				</div>
				<button type="button" className="button button--secondary" onClick={refresh} disabled={loading}>
					<Icon name="refresh" size={15} aria-hidden="true" />
					{loading ? 'Memuat…' : 'Segarkan'}
				</button>
			</div>

			<div className="dashboard-grid">
				<section className="card balance-card">
					<div className="card-header">
						<div>
							<p className="eyebrow">TOTAL SALDO</p>
							<p className="muted">Saldo terkonfirmasi on-chain</p>
						</div>
						<span className="card-icon card-icon--blue"><Icon name="diamond" size={18} aria-hidden="true" /></span>
					</div>
					<div className="balance-display">
						<AmountDisplay nexu={balance} size="large" ariaLabel="Lihat detail saldo" />
					</div>
					{pending !== 0 ? (
						<p className="balance-alert">
							<Icon name="clock" size={14} aria-hidden="true" />
							<AmountDisplay nexu={pending} size="inline" detailLabel="Rincian" ariaLabel="Lihat detail saldo tertunda" /> menunggu di mempool
						</p>
					) : (
						<p className="balance-status"><span className="status-dot status-dot--success" /> Tidak ada transaksi tertunda</p>
					)}
					<div className="quick-actions">
						<button type="button" className="button button--primary" onClick={() => setTab('kirim')}>
							<Icon name="arrowUpRight" size={16} aria-hidden="true" /> Kirim
						</button>
						<button type="button" className="button button--secondary" onClick={() => setTab('terima')}>
							<Icon name="arrowDownLeft" size={16} aria-hidden="true" /> Terima
						</button>
					</div>
				</section>

				<section className="card address-card">
					<div className="card-header">
						<div>
							<p className="eyebrow">ALAMAT WALLET</p>
							<p className="muted">Gunakan alamat ini untuk menerima NXC</p>
						</div>
						<CopyButton text={address} ariaLabel="Salin alamat wallet" variant="secondary" />
					</div>
					<div className="address-panel">
						<AddressText address={address} head={12} tail={8} />
					</div>
					<button type="button" className="text-button" onClick={() => setTab('terima')}>
						Buka detail penerimaan <Icon name="arrowUpRight" size={14} aria-hidden="true" />
					</button>
				</section>
			</div>

			<section className="card">
				<div className="stat-grid">
					<div className="stat-item">
						<span className="stat-label">Tersedia</span>
						<strong><AmountDisplay nexu={available} size="table" detailLabel="⋯" ariaLabel="Lihat detail saldo tersedia" /></strong>
						<small>Saldo dikurangi pending</small>
					</div>
					<div className="stat-item">
						<span className="stat-label">Nonce berikutnya</span>
						<strong>{nonce}</strong>
						<small>Digunakan saat mengirim</small>
					</div>
					<div className="stat-item">
						<span className="stat-label">Chain ID</span>
						<strong>{chainId ?? '—'}</strong>
						<small>Jaringan NexChain</small>
					</div>
					<div className="stat-item">
						<span className="stat-label">Status node</span>
						<strong className="status-value"><span className={`status-dot ${networkState === 'connected' ? 'status-dot--success' : 'status-dot--warning'}`} />{networkState === 'connected' ? 'Online' : networkState === 'offline' ? 'Terputus' : 'Memuat…'}</strong>
						<small>Diperbarui setiap 15 detik</small>
					</div>
				</div>
			</section>

			<section className="info-strip">
				<div className="info-strip__icon"><Icon name="lock" size={16} aria-hidden="true" /></div>
				<div>
					<strong>Simpan frasa pemulihan secara offline</strong>
					<span>Kunci wallet saat Anda meninggalkan perangkat ini.</span>
				</div>
			</section>
		</div>
	)
}
