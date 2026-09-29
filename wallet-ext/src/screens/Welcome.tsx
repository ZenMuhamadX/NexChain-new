import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { Notice } from '../ui/Notice'
import { useIsPopup, openWalletTab } from '../lib/surface'
import type { Screen } from '../types'

export const Welcome = ({
	go,
}: {
	go: (screen: Screen) => void
}): React.JSX.Element => {
	const isPopup = useIsPopup()
	const [tabError, setTabError] = useState('')

	/**
	 * Di popup, onboarding dijalankan di tab penuh.
	 *
	 * Alasan konkret: Chrome menutup popup begitu pengguna mengklik di luar.
	 * Mengetik passphrase baru dua kali lalu mencatat 12 kata pemulihan di
	 * dalam kotak 360px yang bisa hilang sewaktu-waktu terlalu berisiko.
	 */
	const startInTab = async (): Promise<void> => {
		const message = await openWalletTab()
		if (message) setTabError(message)
	}

	return (
		<section className="auth-card auth-card--welcome">
			<div className="auth-card__mark" aria-hidden="true">
				<Icon name="diamond" size={24} />
			</div>
			<p className="eyebrow">NexChain Wallet</p>
			<h1>Kunci Anda, kendali Anda.</h1>
			<p className="auth-lead">
				Dompet lokal untuk jaringan NexChain. Frasa pemulihan dienkripsi di browser
				ini dan tidak pernah meninggalkan perangkat Anda.
			</p>

			<div className="info-strip" style={{ marginTop: '1rem' }}>
				<div className="info-strip__icon" aria-hidden="true">
					<Icon name="lock" size={15} />
				</div>
				<div>
					<strong>Non-custodial</strong>
					<span>Hanya Anda yang memegang frasa pemulihan dan passphrase.</span>
				</div>
			</div>

			{tabError ? <Notice variant="error">{tabError}</Notice> : null}

			<div className="auth-actions">
				{isPopup ? (
					<button
						type="button"
						className="button button--primary button--wide"
						onClick={() => void startInTab()}
					>
						Mulai di tab penuh
						<Icon name="arrowUpRight" size={15} aria-hidden="true" />
					</button>
				) : null}
				<button
					type="button"
					className="button button--primary button--wide"
					onClick={() => go('create')}
				>
					Buat wallet baru
				</button>
				<button
					type="button"
					className="button button--secondary button--wide"
					onClick={() => go('import')}
				>
					Impor frasa pemulihan
				</button>
			</div>

			<p className="auth-footnote">
				Jangan pernah membagikan frasa pemulihan. Siapa pun yang memilikinya dapat
				mengendalikan dana Anda.
			</p>
		</section>
	)
}
