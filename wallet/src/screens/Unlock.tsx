import { useState } from 'react'
import { errorMessage } from '../lib/format'
import { Icon } from '../ui/Icon'
import { Notice } from '../ui/Notice'
import type { Screen } from '../types'

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

	const submit = async (event?: React.FormEvent): Promise<void> => {
		event?.preventDefault()
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
		<section className="auth-card auth-card--unlock">
			<div className="auth-card__mark" aria-hidden="true">
				<Icon name="lock" size={26} />
			</div>
			<p className="eyebrow">SELAMAT DATANG</p>
			<h1>Buka wallet Anda</h1>
			<p className="auth-lead">Private key hanya berada di memori selama sesi ini terbuka.</p>
			<form onSubmit={(event) => void submit(event)}>
				<input className="sr-only" aria-hidden="true" tabIndex={-1} autoComplete="username" name="username" value="nexchain-wallet" readOnly />
				<div className="field">
					<label className="label" htmlFor="passphrase">
						Passphrase
					</label>
					<input
						id="passphrase"
						className="input"
						type="password"
						value={passphrase}
						autoComplete="current-password"
						autoFocus
						onChange={(event) => setPassphrase(event.target.value)}
					/>
				</div>
				{error ? <Notice variant="error">{error}</Notice> : null}
				<div className="form-actions">
					<button type="button" className="button button--ghost" onClick={() => go('welcome')} disabled={busy}>
						Kembali
					</button>
					<button type="submit" className="button button--primary" disabled={busy}>
						{busy ? 'Membuka…' : 'Buka wallet'}
						<Icon name="arrowUpRight" size={15} aria-hidden="true" />
					</button>
				</div>
			</form>
		</section>
	)
}
