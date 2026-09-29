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
	const [show, setShow] = useState(false)

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
			// Passphrase dipertahankan agar kesalahan ketik kecil bisa
			// diperbaiki; hanya pesan errornya yang diganti.
			setError(errorMessage(error_))
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="auth-card">
			<div className="auth-card__mark" aria-hidden="true">
				<Icon name="lock" size={22} />
			</div>
			<p className="eyebrow">Vault terkunci</p>
			<h1>Buka wallet Anda</h1>
			<p className="auth-lead">
				Masukkan passphrase untuk mendekripsi frasa pemulihan di perangkat ini.
			</p>

			<form onSubmit={(event) => void submit(event)} style={{ marginTop: '0.9rem' }}>
				<input
					className="sr-only"
					aria-hidden="true"
					tabIndex={-1}
					autoComplete="username"
					name="username"
					value="nexchain-wallet"
					readOnly
				/>
				<div className="field">
					<label className="label" htmlFor="passphrase">
						Passphrase
					</label>
					<div className="input-with-action">
						<input
							id="passphrase"
							className={`input ${error ? 'input--invalid' : ''}`}
							type={show ? 'text' : 'password'}
							value={passphrase}
							autoComplete="current-password"
							autoFocus
							aria-invalid={error ? true : undefined}
							onChange={(event) => {
								setPassphrase(event.target.value)
								if (error) setError('')
							}}
						/>
						<button
							type="button"
							className="button button--secondary"
							onClick={() => setShow((value) => !value)}
							title={show ? 'Sembunyikan passphrase' : 'Tampilkan passphrase'}
							aria-label={show ? 'Sembunyikan passphrase' : 'Tampilkan passphrase'}
							aria-pressed={show}
						>
							<Icon name={show ? 'eyeOff' : 'eye'} size={15} aria-hidden="true" />
						</button>
					</div>
				</div>

				{error ? (
					<div style={{ marginTop: '0.6rem' }}>
						<Notice variant="error">{error}</Notice>
					</div>
				) : null}

				<div className="form-actions form-actions--stack" style={{ marginTop: '0.9rem' }}>
					<button type="submit" className="button button--primary" disabled={busy}>
						{busy ? 'Membuka…' : 'Buka wallet'}
					</button>
					<button
						type="button"
						className="button button--ghost"
						onClick={() => go('welcome')}
						disabled={busy}
					>
						Kembali
					</button>
				</div>
			</form>
		</section>
	)
}
