import { useState } from 'react'
import { errorMessage } from '../lib/format'
import { Icon } from '../ui/Icon'
import type { Screen } from '../types'

/**
 * Layar buka kunci: passphrase menurunkan ulang private key dari mnemonic
 * terenkripsi (Phase C) — private key hanya hidup di memori.
 */
export const Unlock = ({
	onUnlock,
	go,
}: {
	onUnlock: (passphrase: string) => Promise<void>
	go: (screen: Screen) => void
}): React.JSX.Element => {
	const [passphrase, setPassphrase] = useState('')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	const submit = async (): Promise<void> => {
		if (!passphrase) {
			setError('Masukkan passphrase.')
			return
		}
		setBusy(true)
		setError('')
		try {
			await onUnlock(passphrase)
		} catch (error_) {
			setError(errorMessage(error_))
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="card center">
			<span className="hero-mark">
				<Icon name="lock" size={22} />
			</span>
			<h1>Buka Kunci Wallet</h1>
			<p className="muted">Masukkan passphrase untuk mengakses wallet.</p>
			<div className="field">
				<label className="label" htmlFor="passphrase">
					Passphrase
				</label>
				<input
					id="passphrase"
					type="password"
					value={passphrase}
					autoComplete="current-password"
					autoFocus
					onChange={(event) => setPassphrase(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') void submit()
					}}
				/>
			</div>
			{error ? <p className="error">{error}</p> : null}
			<div className="row">
				<button className="ghost" onClick={() => go('welcome')} disabled={busy}>
					Kembali
				</button>
				<button className="primary grow" onClick={() => void submit()} disabled={busy}>
					{busy ? 'Membuka…' : 'Buka Kunci'}
				</button>
			</div>
		</section>
	)
}
