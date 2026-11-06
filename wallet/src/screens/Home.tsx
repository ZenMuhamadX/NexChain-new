import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { AmountDisplay } from '../ui/AmountDisplay'
import { ActivityList } from '../ui/ActivityList'
import { getHideBalance, setHideBalance } from '../lib/privacy'

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
	/** Naik saat saldo/pending berubah di latar → segarkan halaman yang dibaca. */
	liveVersion: number
	/** Label status jaringan untuk pil di pita saldo (dihitung App). */
	networkLabel: string
	networkState: 'connected' | 'connecting' | 'offline'
	onSend: () => void
	onReceive: () => void
	onChanged: () => void
	/** Buka layar Riwayat penuh (daftar di beranda hanya pratinjau 5 baris). */
	onViewAll: () => void
}

/**
 * Beranda wallet: pita saldo, dua aksi, lalu aktivitas.
 *
 * Bentuknya mengikuti pola dompet ponsel (pita saldo + aksi besar + daftar),
 * TAPI tanpa etalase layanan dan tanpa kartu promo: wallet ini hanya punya
 * dua aksi nyata, dan mengisi sisanya dengan ubin kosong berarti memajang
 * sesuatu yang tidak bisa diklik.
 *
 * Tab bar TIDAK di sini — ia dipasang `App` supaya tetap di bawah layar mana
 * pun yang sedang dibuka.
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
	liveVersion,
	networkLabel,
	networkState,
	onSend,
	onReceive,
	onChanged,
	onViewAll,
}: HomeProps): React.JSX.Element => {
	/** `NaN` membuat `AmountDisplay` mencetak "—" (lihat `formatNxc`). */
	const shown = (value: number): number => (loaded ? value : Number.NaN)

	/**
	 * Sembunyikan saldo — bertahan setelah aplikasi ditutup.
	 *
	 * Hanya angka besar di pita ini yang disembunyikan, bukan nominal di daftar
	 * aktivitas: sama seperti dompet ponsel pada umumnya, dan menyembunyikan
	 * semuanya membuat daftar tidak bisa dipakai sama sekali.
	 */
	const [hidden, setHidden] = useState(getHideBalance)

	const toggleHidden = (): void => {
		const next = !hidden
		setHidden(next)
		setHideBalance(next)
	}

	return (
		<div className="page-stack">
			<section className="home-band">
				<div className="home-band__top">
					<div className="brand brand--on-band">
						<span className="brand-mark" aria-hidden="true">
							<Icon name="diamond" size={15} />
						</span>
						<span>NexChain</span>
					</div>
					<span
						className={`home-band__net home-band__net--${networkState}`}
						title={networkLabel}
					>
						<span className="network-dot" aria-hidden="true" />
						<span>{networkLabel}</span>
					</span>
				</div>

				<div className="home-band__main">
					<div className="home-band__balance">
						<p className="home-band__label">Saldo</p>
						<div className="home-band__amount-row">
							{/*
							 * `key` membuat elemen ini dipasang ulang tiap toggle, jadi
							 * animasi silang-pudar selalu diputar dari awal — angka dan
							 * titik tidak pernah berganti mendadak.
							 */}
							<span
								className="home-band__value-swap"
								key={hidden ? 'mask' : 'value'}
							>
								{hidden ? (
									<span
										className="home-band__mask"
										aria-label="Saldo disembunyikan"
									>
										••••••
									</span>
								) : (
									<AmountDisplay
										nexu={shown(balance)}
										size="large"
										showUnit={loaded}
										wholeOnly
										detailLabel="Presisi"
										ariaLabel="Lihat saldo presisi"
									/>
								)}
							</span>
							<button
								type="button"
								className="home-band__eye"
								onClick={toggleHidden}
								aria-pressed={hidden}
								aria-label={hidden ? 'Tampilkan saldo' : 'Sembunyikan saldo'}
								title={hidden ? 'Tampilkan saldo' : 'Sembunyikan saldo'}
							>
								<Icon name={hidden ? 'eye' : 'eyeOff'} size={17} />
							</button>
						</div>

						{!loaded ? (
							<p className="home-band__note">
								<span className="status-dot status-dot--warning" /> Saldo belum
								diketahui — menunggu node
							</p>
						) : pending !== 0 ? (
							<p className="home-band__note">
								<Icon name="clock" size={13} aria-hidden="true" />
								{hidden ? (
									<span>Transaksi menunggu di mempool</span>
								) : (
									<>
										<AmountDisplay
											nexu={pending}
											size="inline"
											detailLabel="Rincian"
											ariaLabel="Lihat detail saldo tertunda"
										/>{' '}
										menunggu di mempool
									</>
								)}
							</p>
						) : null}
					</div>

					<div className="home-band__actions">
						<button type="button" className="home-action" onClick={onSend}>
							<span className="home-action__icon" aria-hidden="true">
								<Icon name="arrowUpRight" size={17} />
							</span>
							<span>Kirim</span>
						</button>
						<button type="button" className="home-action" onClick={onReceive}>
							<span className="home-action__icon" aria-hidden="true">
								<Icon name="arrowDownLeft" size={17} />
							</span>
							<span>Terima</span>
						</button>
					</div>
				</div>

				<div className="home-band__foot">
					<button
						type="button"
						className="address-chip address-chip--on-band"
						onClick={onReceive}
						title={address}
					>
						{/* Alamat UTUH, bukan dipotong: di kartu ini ia berperan
						    seperti nomor kartu — sesuatu yang perlu dibaca dan
						    dicocokkan, bukan diringkas. */}
						<code className="mono">{address}</code>
						<Icon name="qr" size={14} aria-hidden="true" />
						<span className="sr-only">Buka kode penerimaan</span>
					</button>
					<button
						type="button"
						className={`home-band__refresh ${refreshing ? 'home-band__refresh--busy' : ''}`}
						onClick={refresh}
						disabled={refreshing}
						aria-label="Segarkan saldo"
						title="Segarkan saldo"
					>
						<Icon name="refresh" size={15} aria-hidden="true" />
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
					liveVersion={liveVersion}
					onChanged={onChanged}
					pageSize={5}
					onViewAll={onViewAll}
				/>
			</section>
		</div>
	)
}
