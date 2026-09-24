import { formatNxc } from '../lib/format'
import { Icon } from '../ui/Icon'
import type { Tab } from '../types'

interface DashboardProps {
	address: string
	/** Saldo akun (nexu) dari `nex_getAccount`. */
	balance: number
	/** Jumlah terkunci karena transaksi masih di mempool (nexu). */
	pending: number
	nonce: number
	chainId: number
	loading: boolean
	refresh: () => void
	setTab: (tab: Tab) => void
}

/**
 * Tab Ringkasan: saldo + metadata jaringan.
 *
 * Semua angka nexu diformat `formatNxc` (BigInt → desimal murni) supaya 18
 * desimal presisi tanpa artefak floating point.
 *
 * Catatan saldo: `balance` adalah saldo akun; `pendingAmount` adalah porsi
 * yang TERKUNCI oleh transaksi masih di mempool — persis definisi di
 * `clientHasSufficient` (`available = balance - pendingAmount`), jadi yang
 * ditampilkan sebagai "Tersedia" memakai rumus identik dengan yang dipakai
 * validasi saldo.
 */
export const Dashboard = ({
	address,
	balance,
	pending,
	nonce,
	chainId,
	loading,
	refresh,
	setTab,
}: DashboardProps): React.JSX.Element => (
	<div className="stack">
		<section className="card balance-card">
			<p className="label">Saldo</p>
			<div className="balance">
				{formatNxc(balance)}
				<span className="balance-unit">NXC</span>
			</div>
			{pending !== 0 ? (
				<p className="pending-note">
					{formatNxc(pending)} NXC terkunci (transaksi masih di mempool)
				</p>
			) : null}
			<div className="row">
				<button className="primary grow" onClick={() => setTab('kirim')}>
					<Icon name="arrowUpRight" size={16} />
					Kirim
				</button>
				<button className="grow" onClick={() => setTab('terima')}>
					<Icon name="arrowDownLeft" size={16} />
					Terima
				</button>
			</div>
			<div className="row end">
				<button className="ghost" onClick={refresh} disabled={loading}>
					<Icon name="refresh" size={14} />
					{loading ? 'Memuat…' : 'Segarkan'}
				</button>
			</div>
		</section>

		<section className="card">
			<div className="field">
				<p className="label">Alamat</p>
				<div className="address mono">{address}</div>
			</div>
			<div className="meta">
				<div>
					<p className="label">Tersedia</p>
					<p className="mono">{formatNxc(balance - pending)} NXC</p>
				</div>
				<div>
					<p className="label">Nonce berikutnya</p>
					<p className="mono">{nonce}</p>
				</div>
				<div>
					<p className="label">Chain ID</p>
					<p className="mono">{chainId}</p>
				</div>
				<div>
					<p className="label">Status</p>
					<p className="mono">{loading ? 'memuat…' : 'siap'}</p>
				</div>
			</div>
		</section>
	</div>
)
