import { Icon } from '../ui/Icon'
import { AuthBrand } from '../ui/AuthBrand'
import type { Screen } from '../types'

export const Welcome = ({
	go,
	hasWallet,
}: {
	go: (screen: Screen) => void
	/** Ada wallet tersimpan — jadi ada layar buka kunci untuk kembali. */
	hasWallet: boolean
}): React.JSX.Element => (
	<section className="auth-card auth-card--welcome">
		<AuthBrand />
		<h1>Kunci Anda. Kendali Anda.</h1>
		<p className="auth-lead">
			Wallet lokal yang tenang untuk jaringan NexChain. Buat wallet baru atau
			pulihkan dari frasa pemulihan Anda.
		</p>

		<div className="trust-grid">
			<div className="trust-item">
				<Icon name="lock" size={16} aria-hidden="true" />
				<div>
					<strong>Lokal secara default</strong>
					<span>Frasa pemulihan Anda dienkripsi di browser ini.</span>
				</div>
			</div>
			<div className="trust-item">
				<Icon name="diamond" size={16} aria-hidden="true" />
				<div>
					<strong>Siap untuk Explorer</strong>
					<span>Lacak setiap transaksi yang sudah masuk blok.</span>
				</div>
			</div>
		</div>

		<div className="auth-actions">
			<button type="button" className="button button--primary button--wide" onClick={() => go('create')}>
				Buat wallet baru
				<Icon name="arrowUpRight" size={16} aria-hidden="true" />
			</button>
			<button type="button" className="button button--secondary button--wide" onClick={() => go('import')}>
				Impor frasa pemulihan
			</button>
			{/*
			 * Tanpa ini, layar ini adalah jalan buntu bagi pengguna yang sudah
			 * punya wallet: dari sini tidak ada jalan kembali ke buka kunci
			 * selain me-refresh halaman.
			 */}
			{hasWallet ? (
				<button type="button" className="button button--ghost button--wide" onClick={() => go('unlock')}>
					Kembali ke buka kunci
				</button>
			) : null}
		</div>

		<p className="auth-footnote">
			Jangan pernah membagikan frasa pemulihan. Siapa pun yang memilikinya dapat mengendalikan dana Anda.
		</p>
	</section>
)
