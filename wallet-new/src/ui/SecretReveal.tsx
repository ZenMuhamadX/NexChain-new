import { useEffect, useState } from 'react'

/** Keep a revealed secret on screen for one minute, then hide it again. */
const AUTO_HIDE_MS = 60_000

/**
 * Reveals a vault secret after the passphrase is re-entered.
 *
 * This component is deliberately network-free: `load` reads the already
 * unlocked vault in memory. No fetch, storage, clipboard, or log call belongs
 * here, and `scripts/uiCheck.ts` enforces that.
 */
export const SecretReveal = ({
	label,
	load,
}: {
	label: string
	load: (passphrase: string) => Promise<string>
}) => {
	const [value, setValue] = useState('')
	const [passphrase, setPassphrase] = useState('')
	const [confirming, setConfirming] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string>()

	const hide = () => {
		setValue('')
		setPassphrase('')
		setConfirming(false)
		setError(undefined)
	}

	useEffect(() => {
		if (value === '') return
		const timer = window.setTimeout(hide, AUTO_HIDE_MS)
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') hide()
		}
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			window.clearTimeout(timer)
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}, [value])

	const reveal = async () => {
		setBusy(true)
		setError(undefined)
		try {
			const secret = await load(passphrase)
			setPassphrase('')
			setConfirming(false)
			setValue(secret)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="secret-row">
			<div className="secret-head">
				<span>{label}</span>
				{value === '' && !confirming ? (
					<button
						type="button"
						className="btn btn-quiet btn-small"
						aria-label={`Show ${label}`}
						onClick={() => setConfirming(true)}
					>
						Show
					</button>
				) : null}
				{value !== '' ? (
					<button
						type="button"
						className="btn btn-quiet btn-small"
						aria-label={`Hide ${label}`}
						onClick={hide}
					>
						Hide
					</button>
				) : null}
			</div>
			{value !== '' ? (
				<code className="secret-value break-all">{value}</code>
			) : confirming ? (
				<form
					className="secret-confirm"
					onSubmit={(event) => {
						event.preventDefault()
						void reveal()
					}}
				>
					<label className="field">
						<span>Passphrase</span>
						<input
							type="password"
							value={passphrase}
							aria-label={`Passphrase to reveal ${label}`}
							autoComplete="off"
							onChange={(event) => setPassphrase(event.target.value)}
							required
						/>
					</label>
					<div className="secret-actions">
						<button
							type="button"
							className="btn btn-quiet btn-small"
							aria-label={`Cancel revealing ${label}`}
							onClick={hide}
						>
							Cancel
						</button>
						<button
							type="submit"
							className="btn btn-secondary btn-small"
							aria-label={`Reveal ${label}`}
							disabled={busy || passphrase === ''}
						>
							{busy ? 'Checking...' : 'Reveal'}
						</button>
					</div>
					{error ? (
						<p className="field-error" role="alert">
							{error}
						</p>
					) : null}
				</form>
			) : (
				<p className="secret-masked">Hidden. Passphrase required.</p>
			)}
		</div>
	)
}
