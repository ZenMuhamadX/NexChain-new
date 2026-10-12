import { Icon } from '../ui/Icon'
import type { Screen } from '../types'

export const Welcome = ({
	go,
}: {
	go: (screen: Screen) => void
}): React.JSX.Element => (
	<section className="auth-card auth-card--welcome">
		<div className="auth-card__mark" aria-hidden="true">
			<Icon name="diamond" size={28} />
		</div>
		<p className="eyebrow">NEXCHAIN WALLET</p>
		<h1>Kunci Anda. Kendali Anda.</h1>
		<p className="auth-lead">
			Dompet lokal yang tenang untuk jaringan NexChain. Buat vault baru atau pulihkan
			dari frasa pemulihan Anda.
		</p>

		<div className="trust-grid">
			<div className="trust-item">
				<Icon name="lock" size={16} aria-hidden="true" />
				<div>
					<strong>Lokal secara default</strong>
					<span>Mnemonic Anda dienkripsi di browser ini.</span>
				</div>
			</div>
			<div className="trust-item">
				<Icon name="diamond" size={16} aria-hidden="true" />
				<div>
					<strong>Siap untuk Explorer</strong>
					<span>Lacak setiap transaksi terkonfirmasi on-chain.</span>
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
		</div>

		<p className="auth-footnote">
			Jangan pernah membagikan frasa pemulihan. Siapa pun yang memilikinya dapat mengendalikan dana Anda.
		</p>
	</section>
)
