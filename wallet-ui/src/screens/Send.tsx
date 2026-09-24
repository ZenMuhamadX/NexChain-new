import { useState } from 'react'
import { validateSendForm, sendForm, hasSendErrors, DEFAULT_FEE_NEXU } from '../lib/sendFlow'
import type { SendErrors, SendForm } from '../lib/sendFlow'
import { errorMessage, formatNxc } from '../lib/format'
import type { Tab } from '../types'

interface SendProps {
	sender: string
	balance: number
	privateKey: string
	onSent: () => void
	setTab: (tab: Tab) => void
}

/**
 * Tab Kirim — validasi form mencerminkan aturan server (`validateSendForm`
 * menyalin `isValid*` + Joi), lalu `sendForm` menjalankan nonce → sign →
 * `clientSideTxValidate` → `nex_sendRawTransaction`.
 */
export const Send = ({ sender, balance, privateKey, onSent, setTab }: SendProps): React.JSX.Element => {
	const [form, setForm] = useState<SendForm>({ receiver: '', amountNxc: '', feeNexu: String(DEFAULT_FEE_NEXU) })
	const [message, setMessage] = useState('')
	const [errors, setErrors] = useState<SendErrors>({})
	const [touched, setTouched] = useState(false)
	const [busy, setBusy] = useState(false)
	const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

	const update = (patch: Partial<SendForm>): void => {
		const next = { ...form, ...patch }
		setForm(next)
		if (touched) setErrors(validateSendForm(next, sender))
	}

	const submit = async (): Promise<void> => {
		setTouched(true)
		const found = validateSendForm(form, sender)
		setErrors(found)
		if (hasSendErrors(found)) return

		setBusy(true)
		setResult(null)
		try {
			const outcome = await sendForm({ ...form, message }, sender, privateKey)
			if (outcome.ok) {
				setResult({ ok: true, text: `Terkirim — txHash ${outcome.txHash}` })
				setForm({ receiver: '', amountNxc: '', feeNexu: String(DEFAULT_FEE_NEXU) })
				setMessage('')
				setTouched(false)
				setErrors({})
				onSent()
			} else {
				setResult({ ok: false, text: outcome.error ?? 'Gagal mengirim.' })
			}
		} catch (error) {
			setResult({ ok: false, text: errorMessage(error) })
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="card">
			<div className="card-head">
				<h2>Kirim NXC</h2>
				<span className="chip">Saldo: {formatNxc(balance)} NXC</span>
			</div>

			<div className="field">
				<label className="label" htmlFor="receiver">Alamat penerima</label>
				<input id="receiver" className="mono" placeholder="Nx…" value={form.receiver} onChange={(e) => update({ receiver: e.target.value })} />
				{touched && errors.receiver ? <p className="error">{errors.receiver}</p> : null}
			</div>

			<div className="field">
				<label className="label" htmlFor="amount">Jumlah (NXC)</label>
				<input id="amount" type="text" inputMode="decimal" placeholder="0.0" value={form.amountNxc} onChange={(e) => update({ amountNxc: e.target.value })} />
				{touched && errors.amount ? <p className="error">{errors.amount}</p> : null}
			</div>

			<div className="field">
				<label className="label" htmlFor="fee">Fee (nexu)</label>
				<input id="fee" type="text" inputMode="numeric" value={form.feeNexu} onChange={(e) => update({ feeNexu: e.target.value })} />
				{touched && errors.fee ? <p className="error">{errors.fee}</p> : null}
			</div>

			<div className="field">
				<label className="label" htmlFor="message">Pesan (opsional)</label>
				<input id="message" maxLength={100} placeholder="catatan singkat" value={message} onChange={(e) => setMessage(e.target.value)} />
			</div>

			{result ? <p className={result.ok ? 'notice ok' : 'notice error'}>{result.text}</p> : null}

			<div className="row">
				<button className="ghost" onClick={() => setTab('ringkasan')} disabled={busy}>Batal</button>
				<button className="primary grow" onClick={() => void submit()} disabled={busy}>{busy ? 'Mengirim…' : 'Kirim'}</button>
			</div>
		</section>
	)
}
