import { useEffect, useMemo, useState } from 'react'
import { genRandomMnemonic } from 'key/genRandomMnemonic'
import { validateMnemonic } from 'key/validateMnemonic'
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

	/**
	 * Kata-kata frasa pemulihan, hanya saat MODE CREATE.
	 *
	 * Di mode import `mnemonic` adalah input pengguna yang mungkin belum 12
	 * kata valid — memecahnya jadi grid berindeks justru membingungkan.
	 */
	const words = useMemo(
		() =>
			mode === 'create'
				? mnemonic.trim().split(/\s+/).filter(Boolean)
				: [],
		[mnemonic, mode],
	)

	useEffect(() => {
		setBackedUp(false)
		setError('')
		setReveal(mode === 'import')
		setPassphrase('')
		setConfirm('')
		setMnemonic(mode === 'create' ? genRandomMnemonic() : '')
	}, [mode])

	/**
	 * Frasa dibuat saat mode berubah, bukan saat komponen dipasang. Tanpa efek
	 * ini, membuka "Buat wallet", menekan Kembali, lalu masuk lagi akan
	 * menampilkan frasa yang SAMA — pengguna bisa mengira itu normal padahal
	 * artinya frasa sudah pernah terekspos di layar sebelumnya.
	 */

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
			setError('Centang konfirmasi bahwa frasa sudah dicatat.')
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
			<input
				className="sr-only"
				aria-hidden="true"
				tabIndex={-1}
				autoComplete="username"
				name="username"
				value="nexchain-wallet"
				readOnly
			/>
			<div className="stepper" aria-label="Progres penyiapan wallet">
				<div className="stepper__step stepper__step--active">
					<span>1</span> Frasa
				</div>
				<div className="stepper__line" />
				<div
					className={`stepper__step ${
						passphrase.length >= 8 ? 'stepper__step--active' : ''
					}`}
				>
					<span>2</span> Passphrase
				</div>
			</div>

			<p className="eyebrow">{mode === 'create' ? 'Wallet baru' : 'Pulihkan wallet'}</p>
			<h1>{mode === 'create' ? 'Buat wallet Anda' : 'Pulihkan wallet Anda'}</h1>
			<p className="auth-lead">
				{mode === 'create'
					? 'Frasa ini dibuat di browser Anda dan tidak pernah dikirim ke mana pun.'
					: 'Masukkan 12 kata frasa pemulihan yang pernah Anda simpan.'}
			</p>

			<div className="form-divider" style={{ margin: '0.9rem 0' }} />

			{mode === 'create' ? (
				<div className="field">
					<div className="field-heading">
						<span className="label">Frasa pemulihan</span>
						<span className="field-badge">12 kata</span>
					</div>

					{/* Grid bernomor lebih mudah dicatat dan dibandingkan ulang
					    daripada blok teks panjang. */}
					<ol className={`mnemonic-grid ${reveal ? '' : 'mnemonic-grid--blurred'}`}>
						{words.map((word, index) => (
							<li key={`${index}-${word}`}>
								<span>{reveal ? word : '••••••'}</span>
							</li>
						))}
					</ol>

					<div className="field-actions">
						<button
							type="button"
							className="button button--ghost button--sm"
							onClick={() => setReveal((value) => !value)}
							aria-pressed={reveal}
						>
							<Icon name={reveal ? 'eyeOff' : 'eye'} size={14} aria-hidden="true" />
							{reveal ? 'Sembunyikan' : 'Tampilkan'}
						</button>
						{reveal ? (
							<CopyButton
								text={mnemonic}
								ariaLabel="Salin frasa pemulihan"
								variant="secondary"
								size={14}
							>
								Salin frasa
							</CopyButton>
						) : null}
					</div>

					<label className={`check-card ${backedUp ? 'check-card--checked' : ''}`}>
						<input
							type="checkbox"
							checked={backedUp}
							onChange={(event) => setBackedUp(event.target.checked)}
						/>
						<span>
							<strong>Saya sudah mencatat frasa ini</strong>
							<small>
								Tulis di kertas dan simpan offline. Jangan pernah membagikannya.
							</small>
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
						rows={3}
						autoFocus
						spellCheck={false}
						autoComplete="off"
						placeholder="Masukkan 12 kata dipisahkan spasi"
						onChange={(event) => setMnemonic(event.target.value)}
					/>
					<p className="input-hint">
						Spasi ganda dan baris baru otomatis dirapikan.
					</p>
				</div>
			)}

			<div className="form-divider" style={{ margin: '0.9rem 0' }} />

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
				<div
					className="strength-meter"
					aria-label={`Kekuatan passphrase: ${passphraseLabel(score)}`}
				>
					<div className="strength-meter__track">
						<span className={`strength-meter__fill strength-meter__fill--${score}`} />
					</div>
					<span>{passphraseLabel(score)}</span>
				</div>
			</div>

			<div className="field">
				<label className="label" htmlFor="confirm">
					Ulangi passphrase
				</label>
				<input
					id="confirm"
					className={`input ${
						confirm && confirm !== passphrase ? 'input--invalid' : ''
					}`}
					type="password"
					value={confirm}
					autoComplete="new-password"
					placeholder="Ulangi passphrase"
					onChange={(event) => setConfirm(event.target.value)}
				/>
			</div>

			{error ? <Notice variant="error">{error}</Notice> : null}

			<div className="form-actions form-actions--stack" style={{ marginTop: '1rem' }}>
				<button type="submit" className="button button--primary" disabled={busy}>
					{busy ? 'Menyimpan wallet…' : mode === 'create' ? 'Buat wallet' : 'Pulihkan wallet'}
					<Icon name="arrowUpRight" size={15} aria-hidden="true" />
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
	)
}
