import {
	useCallback,
	useEffect,
	useState,
	type AnimationEvent,
	type ReactNode,
} from 'react'
import { toDataURL } from 'qrcode'
import nxcTicker from '../../../brand/asset/nxc_ticker_transparent.svg'
import { formatNxc, validateSendForm, type SendForm } from '../index'
import { explorerTxUrl } from '../shell/explorer'
import { Icon } from './Icon'
import { CopyButton } from './screens'

const useSheetExit = (onClose: () => void) => {
	const [closing, setClosing] = useState(false)
	const close = useCallback(() => setClosing(true), [])
	const finish = useCallback(
		(event: AnimationEvent<HTMLElement>) => {
			if (closing && event.target === event.currentTarget) onClose()
		},
		[closing, onClose],
	)
	return { closing, close, finish }
}

const Sheet = ({
	title,
	exit,
	children,
}: {
	title: string
	exit: ReturnType<typeof useSheetExit>
	children: ReactNode
}) => {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') exit.close()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [exit.close])

	return (
		<div className={`sheet-layer${exit.closing ? ' is-closing' : ''}`}>
			<div className="sheet-backdrop" onClick={exit.close} aria-hidden="true" />
			<section
				className="sheet"
				role="dialog"
				aria-modal="true"
				aria-label={title}
				onAnimationEnd={exit.finish}
			>
				<div className="sheet-head">
					<h2>{title}</h2>
					<button
						type="button"
						className="icon-button"
						aria-label="Close"
						onClick={exit.close}
					>
						<Icon name="close" size={18} />
					</button>
				</div>
				{children}
			</section>
		</div>
	)
}

export interface PrepareResult {
	fee?: number
	error?: string
}

export interface SubmitResult {
	txHash?: string
	error?: string
}

export const SendSheet = ({
	address,
	availableNexu,
	onClose,
	onPrepare,
	onSubmit,
}: {
	address: string
	availableNexu: number
	onClose: () => void
	onPrepare: (form: SendForm) => Promise<PrepareResult>
	onSubmit: () => Promise<SubmitResult>
}) => {
	const [form, setForm] = useState<SendForm>({
		receiver: '',
		amountNxc: '',
		message: '',
	})
	const [step, setStep] = useState<'form' | 'review' | 'done'>('form')
	const [fee, setFee] = useState<number>()
	const [txHash, setTxHash] = useState<string>()
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const exit = useSheetExit(onClose)

	const localErrors = validateSendForm(form, address, availableNexu)

	const prepare = async () => {
		const first = Object.values(localErrors)[0]
		if (first) {
			setError(first)
			return
		}
		setBusy(true)
		setError(undefined)
		try {
			const result = await onPrepare(form)
			if (result.error) {
				setError(result.error)
				return
			}
			setFee(result.fee)
			setStep('review')
		} finally {
			setBusy(false)
		}
	}

	const submit = async () => {
		setBusy(true)
		setError(undefined)
		try {
			const result = await onSubmit()
			if (result.error) {
				setError(result.error)
				return
			}
			setTxHash(result.txHash)
			setStep('done')
		} finally {
			setBusy(false)
		}
	}

	return (
		<Sheet title="Send NXC" exit={exit}>
			{step === 'form' ? (
				<form
					className="stack"
					onSubmit={(event) => {
						event.preventDefault()
						void prepare()
					}}
				>
					<label className="field">
						<span>Recipient address</span>
						<input
							type="text"
							value={form.receiver}
							onChange={(event) =>
								setForm({ ...form, receiver: event.target.value })
							}
							placeholder="NxC..."
							className="mono"
							autoFocus
							required
						/>
					</label>
					<label className="field">
						<span>Amount</span>
						<span className="amount-wrap">
							<input
								type="text"
								inputMode="decimal"
								value={form.amountNxc}
								onChange={(event) =>
									setForm({ ...form, amountNxc: event.target.value })
								}
								placeholder="0.00"
								required
							/>
							<span className="input-suffix">NXC</span>
						</span>
					</label>
					<label className="field">
						<span>Message, optional</span>
						<input
							type="text"
							value={form.message}
							onChange={(event) =>
								setForm({ ...form, message: event.target.value })
							}
						/>
					</label>
					{Object.values(localErrors).filter(Boolean).length > 0 ? (
						<p className="field-error" role="alert">
							{Object.values(localErrors).filter(Boolean).join(' ')}
						</p>
					) : null}
					{error ? (
						<p className="field-error" role="alert">
							{error}
						</p>
					) : null}
					<button
						type="submit"
						className="btn btn-primary"
						disabled={busy}
						aria-label="Review transaction"
					>
						{busy ? 'Preparing...' : 'Review'}
					</button>
				</form>
			) : null}
			{step === 'review' ? (
				<div className="stack">
					<div className="receipt">
						<div className="receipt-top">
							<span className="receipt-label">You are sending</span>
							<strong className="receipt-amount">
								{form.amountNxc} <small>NXC</small>
							</strong>
						</div>
						<div className="receipt-row receipt-to">
							<div className="receipt-row-head">
								<span className="receipt-key">To</span>
								<CopyButton value={form.receiver} />
							</div>
							<span className="receipt-value mono break-all">
								{form.receiver}
							</span>
						</div>
						{form.message ? (
							<div className="receipt-row receipt-message">
								<span className="receipt-key">Message</span>
								<span className="receipt-value">{form.message}</span>
							</div>
						) : null}
						<div className="receipt-row receipt-fee">
							<span className="receipt-key">Network fee, auto</span>
							<span className="receipt-value">{formatNxc(fee ?? 0)} NXC</span>
						</div>
					</div>
					{error ? (
						<p className="field-error" role="alert">
							{error}
						</p>
					) : null}
					<button
						type="button"
						className="btn btn-primary"
						disabled={busy}
						aria-label="Sign and send"
						onClick={() => void submit()}
					>
						{busy ? 'Sending...' : 'Sign and send'}
					</button>
					<button
						type="button"
						className="btn btn-link"
						aria-label="Edit transaction"
						onClick={() => setStep('form')}
					>
						Edit
					</button>
				</div>
			) : null}
			{step === 'done' ? (
				<div className="stack done-view">
					<span className="done-mark">
						<Icon name="check" size={30} />
					</span>
					<h3>Transaction sent.</h3>
					<p className="mono break-all">{txHash}</p>
					{txHash ? (
						<a
							className="text-button"
							href={explorerTxUrl(txHash)}
							target="_blank"
							rel="noopener noreferrer"
						>
							View in Explorer <Icon name="external" size={14} />
						</a>
					) : null}
					<button
						type="button"
						className="btn btn-primary"
						aria-label="Done"
						onClick={exit.close}
					>
						Done
					</button>
				</div>
			) : null}
		</Sheet>
	)
}

export const ReceiveSheet = ({
	address,
	onClose,
}: {
	address: string
	onClose: () => void
}) => {
	const [qr, setQr] = useState('')
	const [copied, setCopied] = useState(false)
	const exit = useSheetExit(onClose)

	useEffect(() => {
		let active = true
		void toDataURL(address, {
			errorCorrectionLevel: 'H',
			margin: 0,
			width: 156,
			color: { dark: '#000000', light: '#FFFFFF' },
		}).then((data) => {
			if (active) setQr(data)
		})
		return () => {
			active = false
		}
	}, [address])

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') exit.close()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [exit.close])

	useEffect(() => {
		if (!copied) return
		const timer = window.setTimeout(() => setCopied(false), 1600)
		return () => window.clearTimeout(timer)
	}, [copied])

	return (
		<div className={`sheet-layer${exit.closing ? ' is-closing' : ''}`}>
			<div
				className="receive-screen"
				role="dialog"
				aria-modal="true"
				aria-label="Receiving Address"
				onAnimationEnd={exit.finish}
			>
				<header className="receive-header">
					<button
						type="button"
						className="receive-back"
						aria-label="Back"
						onClick={exit.close}
					>
						←
					</button>
					<h2>Receiving Address</h2>
				</header>
				<div className="receive-body">
					<div className="qr-card">
						{qr ? (
							<img
								className="qr-image"
								src={qr}
								alt="QR code for your NexChain address"
							/>
						) : (
							<span className="qr-loading" aria-label="Generating QR code" />
						)}
						<span className="qr-logo" aria-hidden="true">
							<img src={nxcTicker} alt="" />
						</span>
					</div>
					<p className="receive-label">Your NexChain Address</p>
					<div className="receive-card">
						<p className="receive-address mono break-all">{address}</p>
						<button
							type="button"
							className="receive-copy"
							aria-label={copied ? 'Address copied' : 'Copy address'}
							onClick={() => {
								void navigator.clipboard
									.writeText(address)
									.then(() => setCopied(true))
							}}
						>
							<Icon name={copied ? 'check' : 'copy'} size={18} />
							{copied ? 'Copied' : 'Copy'}
						</button>
					</div>
					<p className="receive-help">
						Only used to receive tokens on the NexChain network.
					</p>
				</div>
				<button
					type="button"
					className="btn receive-close"
					aria-label="Close"
					onClick={exit.close}
				>
					Close
				</button>
			</div>
		</div>
	)
}
