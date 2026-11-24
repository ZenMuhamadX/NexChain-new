import { useState } from 'react'
import { errorMessage } from '../lib/format'
import { AuthBrand } from '../ui/AuthBrand'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
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
	const [confirmSwitch, setConfirmSwitch] = useState(false)

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
			<AuthBrand />
			<h1>Buka wallet Anda</h1>
			<p className="auth-lead">
				Kunci pribadi hanya berada di memori selama sesi ini terbuka.
			</p>
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
					<button
						type="button"
						className="button button--ghost"
						onClick={() => setConfirmSwitch(true)}
						disabled={busy}
					>
						Ganti wallet
					</button>
					<button type="submit" className="button button--primary" disabled={busy}>
						{busy ? 'Membuka…' : 'Buka wallet'}
						<Icon name="arrowUpRight" size={15} aria-hidden="true" />
					</button>
				</div>
			</form>

			{/*
			 * "Kembali" dulu langsung melempar ke Welcome, yang hanya menawarkan
			 * Buat/Impor — seolah wallet di perangkat ini hilang. Dialog ini
			 * menyatakan bahwa wallet TIDAK dihapus sebelum layar itu dibuka.
			 */}
			<Modal
				open={confirmSwitch}
				onClose={() => setConfirmSwitch(false)}
				title="Ganti wallet?"
				size="sm"
				actions={
					<div className="modal-actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() => setConfirmSwitch(false)}
						>
							Batal
						</button>
						<button
							type="button"
							className="button button--primary"
							onClick={() => {
								setConfirmSwitch(false)
								go('welcome')
							}}
						>
							Ke layar awal
						</button>
					</div>
				}
			>
				<p>
					Wallet di perangkat ini tidak dihapus. Anda bisa membukanya lagi
					kapan saja dengan passphrase yang sama — frasa pemulihan hanya
					dibutuhkan bila wallet ini dihapus.
				</p>
			</Modal>
		</section>
	)
}
