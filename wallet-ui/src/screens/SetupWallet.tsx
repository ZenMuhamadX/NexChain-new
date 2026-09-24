import { useEffect, useState } from 'react'
import { genRandomMnemonic } from 'key/genRandomMnemonic'
import { validateMnemonic } from 'key/validateMnemonic'
import { errorMessage } from '../lib/format'
import { Icon } from '../ui/Icon'
import type { Screen } from '../types'

interface SetupProps {
	mode: 'create' | 'import'
	onDone: (mnemonic: string, passphrase: string) => Promise<void>
	go: (screen: Screen) => void
}

/**
 * Form buat/impor wallet Phase C.
 *
 * - `create` : mnemonic dibangkitkan lokal (`genRandomMnemonic`, alias modul
 *   root — bukan import bip39 langsung) lalu ditampilkan sekali — user wajib
 *   menyimpannya sebelum lanjut.
 * - `import` : frasa divalidasi `validateMnemonic` (melempar
 *   `Invalid mnemonic phrase` bila salah) sebelum menyentuh vault.
 * - passphrase WAJIB (kebijakan vault: `Wallet requires a passphrase`).
 */
export const SetupWallet = ({ mode, onDone, go }: SetupProps): React.JSX.Element => {
	const [mnemonic, setMnemonic] = useState<string>(() =>
		mode === 'create' ? genRandomMnemonic() : '',
	)
	const [passphrase, setPassphrase] = useState('')
	const [confirm, setConfirm] = useState('')
	const [reveal, setReveal] = useState(mode === 'import')
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	// Mnemonic baru diganti saat kembali ke mode create.
	useEffect(() => {
		if (mode === 'create') setMnemonic(genRandomMnemonic())
	}, [mode])

	const submit = async (): Promise<void> => {
		setError('')
		// Normalisasi penuh: trim + replace multiple spaces/newlines (sama dengan vault)
		const phrase = mnemonic.trim().replace(/\s+/g, ' ')

		try {
			validateMnemonic(phrase) // melempar 'Invalid mnemonic phrase'
		} catch {
			setError('Mnemonic tidak valid — periksa urutan dan ejaan kata.')
			return
		}
		if (passphrase.length < 4) {
			setError('Passphrase minimal 4 karakter.')
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
		<section className="card">
			<h1>{mode === 'create' ? 'Buat Wallet' : 'Impor Mnemonic'}</h1>

			{mode === 'create' ? (
				<>
					<div className="field">
						<label className="label" htmlFor="mnemonic">
							Frasa mnemonic (12 kata) — simpan di tempat aman
						</label>
						<textarea
							id="mnemonic"
							className="mnemonic"
							readOnly={!reveal}
							value={mnemonic}
							rows={3}
						/>
						<div className="row end">
							<button className="ghost" onClick={() => setReveal((value) => !value)}>
								<Icon name={reveal ? 'eyeOff' : 'eye'} size={15} />
								{reveal ? 'Sembunyikan' : 'Tampilkan'}
							</button>
						</div>
					</div>
					<p className="hint">
						Frasa ini adalah satu-satunya cara memulihkan wallet. Frasa tidak
						pernah disimpan tanpa enkripsi.
					</p>
				</>
			) : (
				<div className="field">
					<label className="label" htmlFor="mnemonic">
						Mnemonic (12 kata)
					</label>
					<textarea
						id="mnemonic"
						className="mnemonic"
						value={mnemonic}
						rows={3}
						placeholder="masukkan frasa mnemonic…"
						onChange={(event) => setMnemonic(event.target.value)}
					/>
				</div>
			)}

			<div className="field">
				<label className="label" htmlFor="passphrase">
					Passphrase (untuk mengunci mnemonic)
				</label>
				<input
					id="passphrase"
					type="password"
					value={passphrase}
					autoComplete="new-password"
					placeholder="passphrase…"
					onChange={(event) => setPassphrase(event.target.value)}
				/>
			</div>

			<div className="field">
				<label className="label" htmlFor="confirm">
					Ulangi passphrase
				</label>
				<input
					id="confirm"
					type="password"
					value={confirm}
					autoComplete="new-password"
					placeholder="ulangi passphrase…"
					onChange={(event) => setConfirm(event.target.value)}
				/>
			</div>

			{error ? <p className="error">{error}</p> : null}

			<div className="row">
				<button className="ghost" onClick={() => go('welcome')} disabled={busy}>
					Kembali
				</button>
				<button className="primary grow" onClick={() => void submit()} disabled={busy}>
					{busy ? 'Menyimpan…' : mode === 'create' ? 'Simpan & Lanjut' : 'Impor'}
				</button>
			</div>
		</section>
	)
}
