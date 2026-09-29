import { useMemo, useState } from 'react'
import {
	validateSendForm,
	sendForm,
	hasSendErrors,
	DEFAULT_FEE_NEXU,
} from '../lib/sendFlow'
import type { SendErrors, SendForm } from '../lib/sendFlow'
import { errorMessage } from '../lib/format'
import { explorerTxUrl } from '../lib/explorerUrl'
import { toNexu } from 'nexchain/nexucoin/toNexu'
import { formatNxc } from 'nexchain/nexucoin/formatNxc'
import { Icon } from '../ui/Icon'
import { AmountDisplay } from '../ui/AmountDisplay'
import { AddressText } from '../ui/AddressText'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'
import type { Tab } from '../types'

interface SendProps {
	sender: string
	balance: number
	pending: number
	privateKey: string
	onSent: () => void
	setTab: (tab: Tab) => void
}

type SendResult = { ok: boolean; text: string; txHash?: string }

export const Send = ({
	sender,
	balance,
	pending,
	privateKey,
	onSent,
	setTab,
}: SendProps): React.JSX.Element => {
	const [form, setForm] = useState<SendForm>({
		receiver: '',
		amountNxc: '',
		feeNexu: String(DEFAULT_FEE_NEXU),
	})
	const [message, setMessage] = useState('')
	const [errors, setErrors] = useState<SendErrors>({})
	const [touched, setTouched] = useState(false)
	const [busy, setBusy] = useState(false)
	const [reviewOpen, setReviewOpen] = useState(false)
	const [result, setResult] = useState<SendResult | null>(null)

	const available = Math.max(0, balance - pending)

	const update = (patch: Partial<SendForm>): void => {
		const next = { ...form, ...patch }
		setForm(next)
		if (touched) setErrors(validateSendForm(next, sender))
	}

	/**
	 * Validasi dipisah dari aksi: dipakai untuk menonaktifkan tombol
	 * "Tinjau & kirim" sedini mungkin. Sebelum pengguna menyentuh form kita
	 * tidak menampilkan pesan error, tapi tombolnya sudah benar.
	 */
	const validation = useMemo(() => validateSendForm(form, sender), [form, sender])
	const formValid = !hasSendErrors(validation)

	/** Pesan error yang boleh tampil: hanya setelah field disentuh. */
	const visibleErrors = touched ? errors : validation

	const requestReview = (event?: React.FormEvent): void => {
		event?.preventDefault()
		setTouched(true)
		setErrors(validation)
		if (hasSendErrors(validation)) return
		setResult(null)
		setReviewOpen(true)
	}

	const confirmSend = async (): Promise<void> => {
		setBusy(true)
		try {
			const outcome = await sendForm({ ...form, message }, sender, privateKey)
			setReviewOpen(false)
			if (outcome.ok) {
				setResult({
					ok: true,
					text: 'Transaksi diterima oleh jaringan.',
					txHash: outcome.txHash,
				})
				setForm({ receiver: '', amountNxc: '', feeNexu: String(DEFAULT_FEE_NEXU) })
				setMessage('')
				setTouched(false)
				setErrors({})
				onSent()
			} else {
				setResult({
					ok: false,
					text: outcome.error ?? 'Transaksi ditolak.',
				})
			}
		} catch (error) {
			setReviewOpen(false)
			setResult({ ok: false, text: errorMessage(error) })
		} finally {
			setBusy(false)
		}
	}

	const trackUrl = result?.txHash ? explorerTxUrl(result.txHash) : ''
	// Konversi NXC → nexu lewat `toNexu` (8 desimal). Sebelumnya baris ini
	// memakai `Number(form.amountNxc) * 1e18` — 1e18 adalah desimal Ethereum,
	// bukan NexChain (8 desimal, `NEXU_PER_NXC = 100_000_000`). Untuk jumlah
	// apa pun > 0 hasilnya melewati `MAX_SUPPLY_NEXU` (5 × 10^15) sehingga
	// peringatan "Total melebihi saldo tersedia" SELALU menyala, bahkan saat
	// saldo sebenarnya lebih dari cukup. `toNexu` adalah satu-satunya sumber
	// konversi yang boleh dipakai di UI.
	const amountNexu = ((): number => {
		try {
			return toNexu(form.amountNxc)
		} catch {
			return 0
		}
	})()
	const totalNexu = amountNexu + (Number(form.feeNexu) || 0)
	const insufficient =
		formValid && Number.isFinite(totalNexu) && totalNexu > available

	/* ---- Sukses: layar hasil ringkas, bukan form kosong ---- */
	if (result?.ok) {
		return (
			<div className="page-stack">
				<div className="result-screen">
					<span className="result-screen__mark" aria-hidden="true">
						<Icon name="check" size={26} />
					</span>
					<h1>Transaksi terkirim</h1>
					<p className="muted">{result.text}</p>
					{result.txHash ? (
						<div className="result-box">
							<span className="result-box__label">Hash transaksi</span>
							<code className="mono">{result.txHash}</code>
							<div className="result-box__actions">
								<CopyButton
									text={result.txHash}
									ariaLabel="Salin tx hash"
									variant="secondary"
									size={14}
								>
									Salin hash
								</CopyButton>
								{trackUrl ? (
									<a
										className="button button--ghost button--sm"
										href={trackUrl}
										target="_blank"
										rel="noopener noreferrer"
									>
										Explorer <Icon name="arrowUpRight" size={13} aria-hidden="true" />
									</a>
								) : null}
							</div>
						</div>
					) : null}
					<div className="result-screen__actions">
						<button
							type="button"
							className="button button--secondary button--wide"
							onClick={() => setResult(null)}
						>
							Kirim lagi
						</button>
						<button
							type="button"
							className="button button--primary button--wide"
							onClick={() => setTab('riwayat')}
						>
							Lihat riwayat
						</button>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="page-stack">
			<div className="page-head">
				<h1>Kirim NXC</h1>
				<span className="balance-chip">
					<span>Tersedia</span>
					<strong>
						<AmountDisplay
							nexu={available}
							size="table"
							detailLabel="⋯"
							ariaLabel="Lihat detail saldo tersedia"
						/>
					</strong>
				</span>
			</div>

			{result && !result.ok ? (
				<Notice variant="error">{result.text}</Notice>
			) : null}

			<form className="card form-card" onSubmit={requestReview} noValidate>
				<div className="field">
					<div className="field-heading">
						<label className="label" htmlFor="receiver">
							Alamat penerima
						</label>
						{form.receiver ? (
							<CopyButton
								text={form.receiver}
								ariaLabel="Salin alamat penerima"
								variant="plain"
								size={13}
							>
								Salin
							</CopyButton>
						) : null}
					</div>
					<input
						id="receiver"
						className={`input mono ${visibleErrors.receiver ? 'input--invalid' : ''}`}
						placeholder="NxC… atau NxS…"
						autoComplete="off"
						spellCheck={false}
						value={form.receiver}
						onChange={(event) => update({ receiver: event.target.value })}
						aria-invalid={visibleErrors.receiver ? true : undefined}
					/>
					{visibleErrors.receiver ? (
						<p className="input-error">{visibleErrors.receiver}</p>
					) : (
						<p className="input-hint">43 karakter, diawali NxC atau NxS.</p>
					)}
				</div>

				<div className="form-divider" />

				<div className="field">
					<div className="field-heading">
						<label className="label" htmlFor="amount">
							Jumlah
						</label>
						<button
							type="button"
							className="text-button"
							onClick={() =>
								update({
									// Sisakan fee agar "Maks" tidak menghasilkan tx yang
									// langsung ditolak karena total melebihi saldo.
									amountNxc: trimNxc(
										Math.max(0, available - (Number(form.feeNexu) || 0)),
									),
								})
							}
							disabled={available <= 0}
						>
							Gunakan maks
						</button>
					</div>
					<div className="input-affix">
						<input
							id="amount"
							className={`input input--amount ${visibleErrors.amount ? 'input--invalid' : ''}`}
							inputMode="decimal"
							placeholder="0.0"
							autoComplete="off"
							value={form.amountNxc}
							onChange={(event) => update({ amountNxc: event.target.value })}
							aria-invalid={visibleErrors.amount ? true : undefined}
						/>
						<span className="input-affix__unit">NXC</span>
					</div>
					{visibleErrors.amount ? (
						<p className="input-error">{visibleErrors.amount}</p>
					) : (
						<p className="input-hint">Hingga 8 angka desimal.</p>
					)}
				</div>

				{/* Fee diringkas jadi disclosure: hampir semua pengguna tidak
				    pernah mengubahnya, dan dua input besar berdampingan tidak
				    muat di 360px. */}
				<details className="disclosure">
					<summary>
						<Icon name="sliders" size={14} aria-hidden="true" />
						<span>Biaya jaringan</span>
						<strong>
							<AmountDisplay
								nexu={Number(form.feeNexu) || 0}
								size="inline"
								detailLabel="Rincian"
								ariaLabel="Lihat detail biaya jaringan"
							/>
						</strong>
					</summary>
					<div className="field disclosure__body">
						<label className="label" htmlFor="fee">
							Fee dalam satuan nexu
						</label>
						<input
							id="fee"
							className={`input mono ${visibleErrors.fee ? 'input--invalid' : ''}`}
							inputMode="numeric"
							value={form.feeNexu}
							onChange={(event) => update({ feeNexu: event.target.value })}
							aria-invalid={visibleErrors.fee ? true : undefined}
						/>
						{visibleErrors.fee ? (
							<p className="input-error">{visibleErrors.fee}</p>
						) : (
							<p className="input-hint">
								Sekitar{' '}
								<AmountDisplay
									nexu={Number(form.feeNexu) || 0}
									size="inline"
									showUnit={false}
									detailLabel="Rincian"
									ariaLabel="Lihat detail biaya jaringan"
								/>{' '}
								NXC.
							</p>
						)}
					</div>
				</details>

				<div className="field">
					<label className="label" htmlFor="message">
						Catatan publik <span className="label__optional">opsional</span>
					</label>
					<input
						id="message"
						className="input"
						maxLength={100}
						placeholder="Contoh: Pembayaran invoice #12"
						autoComplete="off"
						value={message}
						onChange={(event) => setMessage(event.target.value)}
					/>
					<p className="input-hint">{message.length}/100 karakter — tersimpan on-chain.</p>
				</div>

				{insufficient ? (
					<Notice variant="warn">
						Total (jumlah + fee) melebihi saldo tersedia.
					</Notice>
				) : null}

				<div className="form-actions form-actions--stack">
					<button
						type="submit"
						className="button button--primary button--wide"
						disabled={busy}
					>
						Tinjau &amp; kirim
						<Icon name="arrowUpRight" size={15} aria-hidden="true" />
					</button>
					<button
						type="button"
						className="button button--ghost button--wide"
						onClick={() => setTab('ringkasan')}
						disabled={busy}
					>
						Batal
					</button>
				</div>
			</form>

			<Modal
				open={reviewOpen}
				onClose={() => !busy && setReviewOpen(false)}
				title="Tinjau transaksi"
				size="sm"
				variant="sheet"
				confirmLabel="Tandatangani &amp; kirim"
				confirmLoading={busy}
				onConfirm={() => void confirmSend()}
			>
				<div className="review-list">
					<div className="review-list__stack">
						<span>Penerima</span>
						<AddressText address={form.receiver} head={12} tail={8} />
					</div>
					<div className="review-list__stack">
						<span>Jumlah</span>
						<strong className="review-amount">
							<AmountDisplay
								nexu={amountNexu}
								size="table"
								detailLabel="⋯"
								ariaLabel="Lihat detail jumlah"
							/>
						</strong>
					</div>
					<div>
						<span>Biaya jaringan</span>
						<strong>
							<AmountDisplay
								nexu={Number(form.feeNexu) || 0}
								size="inline"
								detailLabel="Rincian"
								ariaLabel="Lihat detail biaya jaringan"
							/>
						</strong>
					</div>
					{message.trim() ? (
						<div className="review-list__stack">
							<span>Catatan publik</span>
							<strong>{message}</strong>
						</div>
					) : null}
				</div>
				<Notice variant="warn">
					Transaksi tidak dapat dibatalkan setelah ditandatangani. Periksa alamat
					dan jumlah dengan teliti.
				</Notice>
			</Modal>
		</div>
	)
}

/** nexu → string NXC tanpa nol di ekor (untuk tombol "Gunakan maks"). */
const trimNxc = (nexu: number): string => {
	if (!Number.isSafeInteger(nexu) || nexu <= 0) return '0'
	// `formatNxc` dari `nexchain/nexucoin` sudah memotong trailing zero pada
	// 8 desimal. Sebelumnya implementasi ini memakai `nexu / 1e18` +
	// `padStart(18, '0')` (desimal Ethereum) — keliru untuk NexChain (8).
	return formatNxc(nexu)
}
