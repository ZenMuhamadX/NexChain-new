import { useState } from 'react'
import {
	validateSendForm,
	sendForm,
	previewAutoFee,
	hasSendErrors,
} from '../lib/sendFlow'
import type { SendErrors, SendForm } from '../lib/sendFlow'
import { errorMessage } from '../lib/format'
import { explorerTxUrl } from '../lib/explorerUrl'
import { fetchNextNonce } from '../lib/rpc'
import { Icon } from '../ui/Icon'
import { AmountDisplay } from '../ui/AmountDisplay'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'
import type { Tab } from '../types'

interface SendProps {
	sender: string
	balance: number
	privateKey: string
	onSent: () => void
	setTab: (tab: Tab) => void
}

type SendResult = { ok: boolean; text: string; txHash?: string }

export const Send = ({
	sender,
	balance,
	privateKey,
	onSent,
	setTab,
}: SendProps): React.JSX.Element => {
	const [form, setForm] = useState<SendForm>({
		receiver: '',
		amountNxc: '',
	})
	const [message, setMessage] = useState('')
	const [errors, setErrors] = useState<SendErrors>({})
	const [touched, setTouched] = useState(false)
	const [busy, setBusy] = useState(false)
	/** true saat nonce + ukuran wire sedang diambil sebelum dialog tinjau. */
	const [previewing, setPreviewing] = useState(false)
	const [reviewOpen, setReviewOpen] = useState(false)
	/** Fee hasil `previewAutoFee` — angka yang persis akan ditandatangani. */
	const [feeNexu, setFeeNexu] = useState<number | null>(null)
	const [result, setResult] = useState<SendResult | null>(null)
	const update = (patch: Partial<SendForm>): void => {
		const next = { ...form, ...patch }
		setForm(next)
		if (touched) setErrors(validateSendForm(next, sender))
	}

	const closeReview = (): void => {
		setReviewOpen(false)
		setFeeNexu(null)
	}

	const requestReview = async (event?: React.FormEvent): Promise<void> => {
		event?.preventDefault()
		if (busy || previewing) return
		setTouched(true)
		const found = validateSendForm(form, sender)
		setErrors(found)
		if (hasSendErrors(found)) return

		// Tidak ada lagi input fee: biaya = floor dari ukuran wire transaksi,
		// jadi angkanya hanya diketahui setelah transaksi punya nonce dan ukuran.
		// Pratinjau dijalankan sebelum dialog dibuka supaya user melihat biaya
		// PERSIS yang akan ia tandatangani, bukan perkiraan.
		setPreviewing(true)
		try {
			const nonce = await fetchNextNonce(sender)
			const preview = previewAutoFee(
				{ ...form, message },
				sender,
				privateKey,
				nonce,
			)
			if (!preview.ok || preview.fee === undefined) {
				setResult({
					ok: false,
					text: preview.error ?? 'Gagal menghitung biaya jaringan.',
				})
				return
			}
			setFeeNexu(preview.fee)
			setReviewOpen(true)
		} catch (error) {
			setResult({ ok: false, text: errorMessage(error) })
		} finally {
			setPreviewing(false)
		}
	}

	const confirmSend = async (): Promise<void> => {
		setBusy(true)
		try {
			const outcome = await sendForm({ ...form, message }, sender, privateKey)
			if (outcome.ok) {
				setResult({
					ok: true,
					text: 'Transaksi diterima jaringan. Saldo akan diperbarui setelah transaksi masuk blok.',
					txHash: outcome.txHash,
				})
				setForm({ receiver: '', amountNxc: '' })
				setMessage('')
				setTouched(false)
				setErrors({})
				closeReview()
				onSent()
			} else {
				closeReview()
				setResult({
					ok: false,
					text: outcome.error ?? 'Transaksi ditolak jaringan.',
				})
			}
		} catch (error) {
			closeReview()
			setResult({ ok: false, text: errorMessage(error) })
		} finally {
			setBusy(false)
		}
	}

	const trackUrl = result?.txHash ? explorerTxUrl(result.txHash) : ''

	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<p className="eyebrow">TRANSFER</p>
					<h1>Kirim NXC</h1>
					<p>
						Periksa semua detail sebelum menandatangani dan mengirim transaksi.
					</p>
				</div>
				<div className="balance-chip">
					<span>Tersedia</span>
					<strong>
						<AmountDisplay
							nexu={balance}
							size="table"
							detailLabel="⋯"
							ariaLabel="Lihat detail saldo tersedia"
						/>
					</strong>
				</div>
			</div>

			{result ? (
				<Notice variant={result.ok ? 'ok' : 'error'}>
					<div className="result-copy">
						<strong>
							{result.ok ? 'Transaksi dikirim' : 'Transaksi gagal'}
						</strong>
						<span>{result.text}</span>
						{result.txHash ? (
							<div className="result-hash">
								<code>{result.txHash}</code>
								<CopyButton
									text={result.txHash}
									ariaLabel="Salin tx hash"
									variant="plain"
								/>
								{trackUrl ? (
									<a
										className="text-button"
										href={trackUrl}
										target="_blank"
										rel="noopener noreferrer"
									>
										Lacak di Explorer{' '}
										<Icon name="arrowUpRight" size={13} aria-hidden="true" />
									</a>
								) : null}
							</div>
						) : null}
					</div>
				</Notice>
			) : null}

			<div className="send-layout">
				<form
					className="card form-card"
					onSubmit={(event) => void requestReview(event)}
				>
					<div className="form-section">
						<div className="form-section__heading">
							<span className="step-number">01</span>
							<div>
								<h2>Penerima</h2>
								<p>Masukkan alamat NexChain yang valid.</p>
							</div>
						</div>
						<div className="field">
							<label className="label" htmlFor="receiver">
								Alamat penerima
							</label>
							<input
								id="receiver"
								className="input mono"
								placeholder="NxC…"
								value={form.receiver}
								onChange={(event) => update({ receiver: event.target.value })}
							/>
							{touched && errors.receiver ? (
								<p className="input-error">{errors.receiver}</p>
							) : (
								<p className="input-hint">
									Alamat diawali NxC atau NxS dan terdiri dari 43 karakter.
								</p>
							)}
						</div>
					</div>

					<div className="form-divider" />
					<div className="form-section">
						<div className="form-section__heading">
							<span className="step-number">02</span>
							<div>
								<h2>Jumlah</h2>
								<p>
									Tentukan jumlah yang dikirim — biaya jaringan dihitung
									otomatis.
								</p>
							</div>
						</div>
						<div className="field">
							<label className="label" htmlFor="amount">
								Jumlah (NXC)
							</label>
							<input
								id="amount"
								className="input"
								inputMode="decimal"
								placeholder="0.0"
								value={form.amountNxc}
								onChange={(event) => update({ amountNxc: event.target.value })}
							/>
							{touched && errors.amount ? (
								<p className="input-error">{errors.amount}</p>
							) : null}
							{touched && errors.fee ? (
								<p className="input-error">{errors.fee}</p>
							) : null}
							{!touched || (!errors.amount && !errors.fee) ? (
								<p className="input-hint">
									Mendukung hingga 8 desimal. Biaya jaringan dihitung otomatis
									dari ukuran transaksi (≈1 nexu per byte) dan dibayar ke
									penambang.
								</p>
							) : null}
						</div>
					</div>

					<div className="form-divider" />
					<div className="form-section">
						<div className="form-section__heading">
							<span className="step-number">03</span>
							<div>
								<h2>Catatan Publik (Opsional)</h2>
								<p>Tambahkan pesan publik singkat ke transaksi.</p>
							</div>
						</div>
						<div className="field">
							<label className="label" htmlFor="message">
								Pesan
							</label>
							<input
								id="message"
								className="input"
								maxLength={100}
								placeholder="Contoh: Pembayaran invoice…"
								value={message}
								onChange={(event) => setMessage(event.target.value)}
							/>
						</div>
					</div>

					<div className="form-actions">
						<button
							type="button"
							className="button button--ghost"
							onClick={() => setTab('ringkasan')}
							disabled={busy || previewing}
						>
							Batal
						</button>
						<button
							type="submit"
							className="button button--primary"
							disabled={busy || previewing}
						>
							{previewing ? 'Menghitung biaya…' : 'Tinjau transaksi'}{' '}
							<Icon name="arrowUpRight" size={15} aria-hidden="true" />
						</button>
					</div>
				</form>

				<aside className="card send-summary-card">
					<p className="eyebrow">RINGKASAN TRANSFER</p>
					<h2>Sebelum mengirim</h2>
					<div className="summary-list">
						<div>
							<span>Saldo tersedia</span>
							<strong>
								<AmountDisplay
									nexu={balance}
									size="table"
									detailLabel="⋯"
									ariaLabel="Lihat detail saldo tersedia"
								/>
							</strong>
						</div>
						<div>
							<span>Biaya jaringan</span>
							<strong>Dihitung otomatis dari ukuran transaksi</strong>
						</div>
						<div>
							<span>Jaringan</span>
							<strong>NexChain</strong>
						</div>
						<div>
							<span>Penandatanganan</span>
							<strong>Perangkat lokal</strong>
						</div>
					</div>
					<div className="safety-note">
						<Icon name="lock" size={15} aria-hidden="true" />
						<span>
							Private key digunakan secara lokal dan tidak pernah dikirim ke
							node RPC.
						</span>
					</div>
				</aside>
			</div>

			<Modal
				open={reviewOpen}
				onClose={() => {
					if (!busy) closeReview()
				}}
				title="Tinjau transaksi"
				confirmLabel="Tandatangani & kirim"
				confirmLoading={busy}
				onConfirm={() => void confirmSend()}
			>
				<div className="review-list">
					<div>
						<span>Penerima</span>
						<strong className="mono">{form.receiver}</strong>
					</div>
					<div>
						<span>Jumlah</span>
						<strong>{form.amountNxc} NXC</strong>
					</div>
					<div>
						<span>Biaya jaringan</span>
						<strong>
							{feeNexu === null ? (
								'Dihitung otomatis'
							) : (
								<AmountDisplay
									nexu={feeNexu}
									size="inline"
									detailLabel="Rincian"
									ariaLabel="Lihat detail biaya jaringan"
								/>
							)}
						</strong>
					</div>
					{message.trim() ? (
						<div>
							<span>Pesan</span>
							<strong>{message}</strong>
						</div>
					) : null}
				</div>
				<Notice variant="warn">
					Transaksi tidak dapat dibatalkan setelah ditandatangani. Periksa
					alamat dan jumlah dengan teliti.
				</Notice>
			</Modal>
		</div>
	)
}
