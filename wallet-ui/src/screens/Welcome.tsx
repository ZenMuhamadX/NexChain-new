import { Icon } from '../ui/Icon'
import type { Screen } from '../types'

/**
 * Layar pembuka: membuat wallet baru atau mengimpor mnemonic yang sudah ada.
 * Tidak ada otomatis unlock — user memilih jalur secara eksplisit.
 */
export const Welcome = ({
	go,
}: {
	go: (screen: Screen) => void
}): React.JSX.Element => (
	<section className="card center welcome">
		<span className="hero-mark">
			<Icon name="diamond" size={24} />
		</span>
		<h1>NexChain Wallet</h1>
		<p className="muted">
			Dompet browser untuk jaringan eksperimental NexChain. Kunci disimpan
			lokal di perangkat ini — tidak pernah dikirim ke mana pun.
		</p>
		<div className="stack">
			<button className="primary" onClick={() => go('create')}>
				Buat Wallet Baru
			</button>
			<button onClick={() => go('import')}>Impor Mnemonic</button>
		</div>
		<p className="hint">
			Wallet terkunci otomatis saat tab ditutup. Siapkan passphrase untuk
			mengunci frasa mnemonic di penyimpanan.
		</p>
	</section>
)
