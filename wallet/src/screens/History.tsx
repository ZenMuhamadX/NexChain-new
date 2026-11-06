import { Icon } from '../ui/Icon'
import { ActivityList } from '../ui/ActivityList'

interface HistoryProps {
	address: string
	privateKey: string
	/** Naik setiap transaksi terkirim → daftar dimuat ulang. */
	activityVersion: number
	/** Naik saat saldo/pending berubah di latar → segarkan halaman yang dibaca. */
	liveVersion: number
	onChanged: () => void
	onBack: () => void
}

/**
 * Layar Riwayat: seluruh transaksi alamat ini, satu halaman 10 baris dengan
 * tombol Sebelumnya/Selanjutnya. Beranda hanya menampilkan 5 baris terakhir.
 */
export const History = ({
	address,
	privateKey,
	activityVersion,
	liveVersion,
	onChanged,
	onBack,
}: HistoryProps): React.JSX.Element => (
	<div className="page-stack">
		<div className="page-heading">
			<div>
				<p className="eyebrow">RIWAYAT</p>
				<h1>Semua aktivitas</h1>
				<p>Transaksi terkonfirmasi dan yang masih menunggu di mempool.</p>
			</div>
			<button
				type="button"
				className="button button--secondary page-back"
				onClick={onBack}
			>
				<Icon name="arrowLeft" size={15} aria-hidden="true" /> Kembali
			</button>
		</div>

		<section className="card activity-card">
			<ActivityList
				address={address}
				privateKey={privateKey}
				version={activityVersion}
				liveVersion={liveVersion}
				onChanged={onChanged}
			/>
		</section>
	</div>
)
