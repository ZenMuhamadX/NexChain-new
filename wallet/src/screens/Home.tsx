import { Icon } from '../ui/Icon'
import { AmountDisplay } from '../ui/AmountDisplay'
import { ActivityList } from '../ui/ActivityList'
import { truncate } from '../lib/format'

interface HomeProps {
	address: string
	privateKey: string
	balance: number
	pending: number
	/** false = angka belum pernah berhasil diambil → tampilkan "—", bukan 0. */
	loaded: boolean
	/** true = permintaan sedang berjalan (matikan tombol segarkan). */
	refreshing: boolean
	refresh: () => void
	/** Naik setiap transaksi terkirim → daftar aktivitas dimuat ulang. */
	activityVersion: number
	onSend: () => void
	onReceive: () => void
	onChanged: () => void
	/** Buka layar Riwayat penuh (daftar di beranda hanya pratinjau 5 baris). */
	onViewAll: () => void
}

/**
 * Satu-satunya layar wallet: saldo, dua aksi, lalu aktivitas.
 *
 * Tidak ada tab. Kirim & Terima adalah sheet, dan daftar aktivitas tinggal di
 * layar yang sama — berpindah tab hanya untuk melihat transaksi berarti
 * memuat ulang data yang sama. Riwayat lengkap punya layarnya sendiri supaya
 * beranda tidak memanjang tanpa ujung.
 */
export const Home = ({
	address,
	privateKey,
	balance,
	pending,
	loaded,
	refreshing,
	refresh,
	activityVersion,
	onSend,
	onReceive,
	onChanged,
	onViewAll,
}: HomeProps): React.JSX.Element => {
	/** `NaN` membuat `AmountDisplay` mencetak "—" (lihat `formatNxc`). */
	const shown = (value: number): number => (loaded ? value : Number.NaN)

	return (
		<div className="page-stack">
			<section className="card home-hero">
				<div className="home-hero__head">
					<p className="eyebrow">SALDO</p>
					<button
						type="button"
						className="icon-button"
						onClick={refresh}
						disabled={refreshing}
						aria-label="Segarkan saldo"
						title="Segarkan saldo"
					>
						<Icon name="refresh" size={16} aria-hidden="true" />
					</button>
				</div>

				<div className="hero-amount">
					<AmountDisplay
						nexu={shown(balance)}
						size="large"
						showUnit={loaded}
						ariaLabel="Lihat detail saldo"
					/>
				</div>

				{!loaded ? (
					<p className="hero-note">
						<span className="status-dot status-dot--warning" /> Saldo belum
						diketahui — menunggu node
					</p>
				) : pending !== 0 ? (
					<p className="hero-note">
						<Icon name="clock" size={13} aria-hidden="true" />
						<AmountDisplay
							nexu={pending}
							size="inline"
							detailLabel="Rincian"
							ariaLabel="Lihat detail saldo tertunda"
						/>{' '}
						menunggu di mempool
					</p>
				) : null}

				<button
					type="button"
					className="address-chip"
					onClick={onReceive}
					title={address}
				>
					<code className="mono">{truncate(address, 14, 8)}</code>
					<Icon name="qr" size={14} aria-hidden="true" />
					<span className="sr-only">Buka kode penerimaan</span>
				</button>

				<div className="hero-actions">
					<button
						type="button"
						className="button button--primary button--lg"
						onClick={onSend}
					>
						<Icon name="arrowUpRight" size={17} aria-hidden="true" /> Kirim
					</button>
					<button
						type="button"
						className="button button--secondary button--lg"
						onClick={onReceive}
					>
						<Icon name="arrowDownLeft" size={17} aria-hidden="true" /> Terima
					</button>
				</div>
			</section>

			<section className="card activity-card">
				<div className="section-head">
					<h2>Aktivitas</h2>
					{loaded && pending !== 0 ? (
						<span className="badge badge--pending">
							<span className="status-dot" /> Tertunda
						</span>
					) : null}
				</div>
				<ActivityList
					address={address}
					privateKey={privateKey}
					version={activityVersion}
					onChanged={onChanged}
					pageSize={5}
					onViewAll={onViewAll}
				/>
			</section>
		</div>
	)
}
