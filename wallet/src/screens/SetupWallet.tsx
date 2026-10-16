import { useEffect, useMemo, useState } from 'react'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { validateMnemonic } from 'src/crypto/validateMnemonic'
import { errorMessage } from '../lib/format'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Notice } from '../ui/Notice'
import type { Screen } from '../types'

interface SetupProps {
	mode: 'create' | 'import'
	onDone: (mnemonic: string, passphrase: string) => Promise<void>
	go: (screen: Screen) => void
}

const passphraseScore = (value: string): number => {
	let score = 0
	if (value.length >= 8) score += 1
	if (value.length >= 12) score += 1
	if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1
	if (/\d/.test(value) || /[^\w\s]/.test(value)) score += 1
	return score
}

const passphraseLabel = (score: number): string => {
	if (score <= 0) return 'Terlalu pendek'
	if (score === 1) return 'Perlu diperkuat'
	if (score === 2) return 'Cukup'
	if (score === 3) return 'Kuat'
	return 'Sangat kuat'
}

export const SetupWallet = ({
	mode,
	onDone,
	go,
}: SetupProps): React.JSX.Element => {
	const [mnemonic, setMnemonic] = useState(() =>
		mode === 'create' ? genRandomMnemonic() : '',
	)
	const [passphrase, setPassphrase] = useState('')
	const [confirm, setConfirm] = useState('')
	const [reveal, setReveal] = useState(mode === 'import')
	const [backedUp, setBackedUp] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const score = useMemo(() => passphraseScore(passphrase), [passphrase])

	useEffect(() => {
		setBackedUp(false)
		setReveal(mode === 'import')
		setMnemonic(mode === 'create' ? genRandomMnemonic() : '')
	}, [mode])

	const submit = async (event?: React.FormEvent): Promise<void> => {
		event?.preventDefault()
		setError('')
		const phrase = mnemonic.trim().replace(/\s+/g, ' ')

		try {
			validateMnemonic(phrase)
		} catch {
			setError('Mnemonic tidak valid — periksa urutan dan ejaan kata.')
			return
		}
		if (mode === 'create' && !backedUp) {
			setError('Konfirmasi bahwa mnemonic sudah dicatat sebelum melanjutkan.')
			return
		}
		if (passphrase.length < 8) {
			setError('Passphrase minimal 8 karakter.')
			return
		}
		if (passphrase !== confirm) {
			setError('Konfirmasi passphrase tidak cocok.')
			return
		}

		setBusy(true)
		try {
			await onDone(phrase, passphrase)
		} catch (error_) {
			setError(errorMessage(error_))
		} finally {
			setBusy(false)
		}
	}

	return (
		<form className="auth-card auth-card--wide" onSubmit={(event) => void submit(event)}>
			<input className="sr-only" aria-hidden="true" tabIndex={-1} autoComplete="username" name="username" value="nexchain-wallet" readOnly />
			<div className="stepper" aria-label="Wallet setup progress">
				<div className="stepper__step stepper__step--active">
					<span>1</span> Frasa pemulihan
				</div>
				<div className="stepper__line" />
				<div className={`stepper__step ${passphrase.length >= 8 ? 'stepper__step--active' : ''}`}>
					<span>2</span> Lindungi wallet
				</div>
			</div>

			<div className="page-heading page-heading--compact">
				<p className="eyebrow">{mode === 'create' ? 'WALLET BARU' : 'PULIHKAN WALLET'}</p>
				<h1>{mode === 'create' ? 'Buat wallet Anda' : 'Pulihkan wallet Anda'}</h1>
				<p>
					{mode === 'create'
						? 'Mulai dengan frasa pemulihan yang dibuat secara lokal di browser ini.'
						: 'Masukkan frasa pemulihan 12 kata yang pernah Anda simpan.'}
				</p>
			</div>

			{mode === 'create' ? (
				<div className="field">
					<div className="field-heading">
						<label className="label" htmlFor="mnemonic">
							Frasa pemulihan Anda
						</label>
						<span className="field-badge">12 kata</span>
					</div>
					<textarea
						id="mnemonic"
						className="input mnemonic-input"
						readOnly={!reveal}
						value={mnemonic}
						rows={4}
						aria-describedby="mnemonic-help"
					/>
					<div className="field-actions">
						<button type="button" className="button button--ghost button--sm" onClick={() => setReveal((value) => !value)}>
							<Icon name={reveal ? 'eyeOff' : 'eye'} size={15} aria-hidden="true" />
							{reveal ? 'Sembunyikan frasa' : 'Tampilkan frasa'}
						</button>
						{reveal && backedUp ? <CopyButton text={mnemonic} ariaLabel="Salin frasa pemulihan" variant="secondary" /> : null}
					</div>
					{reveal && !backedUp ? (
						<p className="input-hint">
							Menyalin ke clipboard dinonaktifkan sampai frasa dicadangkan — clipboard berisiko sebelum Anda punya salinan offline.
						</p>
					) : null}
					<p id="mnemonic-help" className="input-hint">
						Catatan kata-kata ini secara berurutan. Ini satu-satunya cara memulihkan wallet ini.
					</p>
					<label className={`check-card ${backedUp ? 'check-card--checked' : ''}`}>
						<input type="checkbox" checked={backedUp} onChange={(event) => setBackedUp(event.target.checked)} />
						<span>
							<strong>Saya sudah menyimpan frasa pemulihan</strong>
							<small>Simpan secara offline dan jangan pernah bagikan kepada siapa pun.</small>
						</span>
					</label>
				</div>
			) : (
				<div className="field">
					<label className="label" htmlFor="mnemonic">
						Frasa pemulihan
					</label>
					<textarea
						id="mnemonic"
						className="input mnemonic-input"
						value={mnemonic}
						rows={4}
						placeholder="Masukkan 12 kata dipisahkan spasi"
						onChange={(event) => setMnemonic(event.target.value)}
					/>
					<p className="input-hint">Gunakan spasi antar kata. Spasi tambahan dan baris baru otomatis dirapikan.</p>
				</div>
			)}

			<div className="form-divider" />
			<div className="form-grid form-grid--two">
				<div className="field">
					<label className="label" htmlFor="passphrase">
						Passphrase
					</label>
					<input
						id="passphrase"
						className="input"
						type="password"
						value={passphrase}
						autoComplete="new-password"
						placeholder="Minimal 8 karakter"
						onChange={(event) => setPassphrase(event.target.value)}
					/>
				</div>
				<div className="field">
					<label className="label" htmlFor="confirm">
						Ulangi passphrase
					</label>
					<input
						id="confirm"
						className="input"
						type="password"
						value={confirm}
						autoComplete="new-password"
						placeholder="Ulangi passphrase"
						onChange={(event) => setConfirm(event.target.value)}
					/>
				</div>
			</div>
			<div className="strength-meter" aria-label={`Kekuatan passphrase: ${passphraseLabel(score)}`}>
				<div className="strength-meter__track">
					<span className={`strength-meter__fill strength-meter__fill--${score}`} />
				</div>
				<span>{passphraseLabel(score)}</span>
			</div>

			{error ? <Notice variant="error">{error}</Notice> : null}

			<div className="form-actions">
				<button type="button" className="button button--ghost" onClick={() => go('welcome')} disabled={busy}>
					Kembali
				</button>
				<button type="submit" className="button button--primary" disabled={busy}>
					{busy ? 'Menyimpan wallet…' : mode === 'create' ? 'Buat wallet' : 'Pulihkan wallet'}
					<Icon name="arrowUpRight" size={15} aria-hidden="true" />
				</button>
			</div>
		</form>
	)
}
