import { useEffect, useState } from 'react'
import {
	validateSendForm,
	buildSignedTransaction,
	sendSignedTransaction,
	hasSendErrors,
} from '../lib/sendFlow'
import type { SendErrors, SendForm } from '../lib/sendFlow'
import { errorMessage, formatNxc, formatNxcExact } from '../lib/format'
import { explorerTxUrl } from '../lib/explorerUrl'
import { fetchNextNonce } from '../lib/rpc'
import type { TxInterface } from 'src/types/transaction'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'

interface SendSheetProps {
	open: boolean
	sender: string
	balance: number
	pending: number
	privateKey: string
	onClose: () => void
	onSent: () => void
}

/** Langkah di dalam SATU sheet — bukan tiga modal terpisah. */
type Step = 'form' | 'review' | 'done'

type SendResult = { ok: boolean; text: string; txHash?: string }

/**
 * Transaksi yang lebih lama dari ini dibangun ulang sebelum dikirim.
 *
 * Nonce yang dipakai saat meninjau bisa sudah terpakai transaksi lain (atau
 * saldo berubah) selama pengguna menimbang. Membangun ulang memakai nonce dan
 * fee yang berlaku sekarang — bukan angka di layar yang sudah basi.
 */
const PREVIEW_TTL_MS = 60_000

/** Batas percobaan loop "Maks": fee bergantung pada panjang angka amount. */
const MAX_FILL_ATTEMPTS = 3

/**
 * Kirim NXC sebagai satu sheet tiga langkah: isian → tinjau → selesai.
 *
 * Semua nominal ditulis sebagai teks, bukan `AmountDisplay`: dialog rincian di
 * dalam dialog memutus focus trap dan membuat satu `Escape` menutup keduanya.
 *
 * Logika transaksi tidak disentuh: `lib/sendFlow.ts` tetap satu-satunya tempat
 * validasi, pembangunan, penandatanganan, dan pengiriman.
 */
export const Send = ({
	open,
	sender,
	balance,
	pending,
	privateKey,
	onClose,
	onSent,
}: SendSheetProps): React.JSX.Element => {
	const [step, setStep] = useState<Step>('form')
	const [form, setForm] = useState<SendForm>({
		receiver: '',
		amountNxc: '',
	})
	const [message, setMessage] = useState('')
	const [noteOpen, setNoteOpen] = useState(false)
	const [errors, setErrors] = useState<SendErrors>({})
	const [touched, setTouched] = useState(false)
	const [busy, setBusy] = useState(false)
	/** true saat nonce + ukuran wire sedang diambil sebelum langkah tinjau. */
	const [previewing, setPreviewing] = useState(false)
	/**
	 * Transaksi yang PERSIS akan dikirim — dibangun sekali saat masuk langkah
	 * tinjau. Mengirim ulang hasil bangun (bukan membangun lagi) menjaga fee
	 * dan nonce di layar sama dengan yang ditandatangani.
	 */
	const [preview, setPreview] = useState<{
		tx: TxInterface
		fee: number
		at: number
	} | null>(null)
	/** Ringkasan transaksi yang barusan terkirim — untuk layar selesai. */
	const [sent, setSent] = useState<{
		amount: number
		receiver: string
		hash?: string
	} | null>(null)
	const [result, setResult] = useState<SendResult | null>(null)
	/** true saat tempel clipboard ditolak (izin/file://) — untuk pesan inline. */
	const [pasteError, setPasteError] = useState('')

	// Model saldo yang sama dengan Beranda: "Tersedia" = saldo terkonfirmasi
	// dikurangi reserve turunan dari mempool. Node menolak send yang melampaui
	// angka ini (`clientHasSufficientBalance`).
	const available = balance - pending

	/**
	 * Setiap kali sheet dibuka, kembali ke langkah isian dan buang hasil
	 * percobaan sebelumnya — tetapi NILAI formulir dibiarkan, supaya menutup
	 * sheet karena salah pencet tidak menghapus alamat yang baru ditempel.
	 */
	useEffect(() => {
		if (!open) return
		setStep('form')
		setPreview(null)
		setSent(null)
		setResult(null)
		setPasteError('')
	}, [open])

	const update = (patch: Partial<SendForm>): void => {
		const next = { ...form, ...patch }
		setForm(next)
		setPasteError('')
		if (touched) setErrors(validateSendForm(next, sender))
	}

	const pasteReceiver = async (): Promise<void> => {
		try {
			const text = await navigator.clipboard.readText()
			if (text.trim()) update({ receiver: text.trim() })
		} catch {
			setPasteError('Tidak dapat membaca clipboard — tempel manual (Ctrl+V).')
		}
	}

	/**
	 * Isi jumlah dengan seluruh saldo yang bisa dikirim.
	 *
	 * Fee dibangun dengan penerima = pengirim karena ukuran wire tidak
	 * bergantung pada ISI alamat (semua alamat 43 karakter), hanya panjangnya.
	 * Loop kecil karena jumlah digit amount ikut mengubah ukuran wire.
	 */
	const fillMax = async (): Promise<void> => {
		if (busy || previewing) return
		setPreviewing(true)
		setResult(null)
		try {
			const nonce = await fetchNextNonce(sender)
			let amount = available
			for (let attempt = 0; attempt < MAX_FILL_ATTEMPTS; attempt += 1) {
				const built = await buildSignedTransaction(
					{ receiver: sender, amountNxc: formatNxc(amount), message },
					sender,
					privateKey,
					nonce,
				)
				if (!built.ok || built.fee === undefined) {
					setResult({
						ok: false,
						text: built.error ?? 'Gagal menghitung biaya jaringan.',
					})
					return
				}
				const next = available - built.fee
				if (next === amount) break
				amount = next
			}
			if (amount <= 0) {
				setResult({
					ok: false,
					text: 'Saldo tidak cukup untuk menutup biaya jaringan.',
				})
				return
			}
			setForm((current) => ({ ...current, amountNxc: formatNxc(amount) }))
		} catch (error) {
			setResult({ ok: false, text: errorMessage(error) })
		} finally {
			setPreviewing(false)
		}
	}

	const requestReview = async (event?: React.FormEvent): Promise<void> => {
		event?.preventDefault()
		if (busy || previewing) return
		setTouched(true)
		const found = validateSendForm(form, sender)
		setErrors(found)
		if (hasSendErrors(found)) return

		// Tidak ada input fee: biaya = floor dari ukuran wire transaksi, jadi
		// angkanya hanya diketahui setelah transaksi punya nonce dan ukuran.
		setPreviewing(true)
		try {
			const nonce = await fetchNextNonce(sender)
			const built = await buildSignedTransaction(
				{ ...form, message },
				sender,
				privateKey,
				nonce,
			)
			if (!built.ok || !built.tx || built.fee === undefined) {
				setResult({
					ok: false,
					text: built.error ?? 'Gagal menghitung biaya jaringan.',
				})
				return
			}
			setPreview({ tx: built.tx, fee: built.fee, at: Date.now() })
			setResult(null)
			setStep('review')
		} catch (error) {
			setResult({ ok: false, text: errorMessage(error) })
		} finally {
			setPreviewing(false)
		}
	}

	const confirmSend = async (): Promise<void> => {
		if (!preview) return
		setBusy(true)
		try {
			let tx = preview.tx
			if (Date.now() - preview.at > PREVIEW_TTL_MS) {
				const nonce = await fetchNextNonce(sender)
				const rebuilt = await buildSignedTransaction(
					{ ...form, message },
					sender,
					privateKey,
					nonce,
				)
				if (!rebuilt.ok || !rebuilt.tx || rebuilt.fee === undefined) {
					setStep('form')
					setPreview(null)
					setResult({
						ok: false,
						text:
							rebuilt.error ??
							'Transaksi perlu dihitung ulang — coba kirim lagi.',
					})
					return
				}
				tx = rebuilt.tx
				setPreview({ tx, fee: rebuilt.fee, at: Date.now() })
			}
			const outcome = await sendSignedTransaction(tx)
			if (outcome.ok) {
				setSent({
					amount: tx.amount,
					receiver: tx.receiver,
					hash: outcome.txHash,
				})
				setResult({
					ok: true,
					text: 'Transaksi diterima jaringan. Saldo akan diperbarui setelah transaksi masuk blok.',
					txHash: outcome.txHash,
				})
				setForm({ receiver: '', amountNxc: '' })
				setMessage('')
				setNoteOpen(false)
				setTouched(false)
				setErrors({})
				setPreview(null)
				setStep('done')
				onSent()
			} else {
				// Kembali ke isian: pengganti dengan nonce yang sama akan ditolak
				// lagi, jadi yang perlu diperbaiki adalah isiannya.
				setStep('form')
				setPreview(null)
				setResult({
					ok: false,
					text: outcome.error ?? 'Transaksi ditolak jaringan.',
				})
			}
		} catch (error) {
			setStep('form')
			setPreview(null)
			setResult({ ok: false, text: errorMessage(error) })
		} finally {
			setBusy(false)
		}
	}

	const close = (): void => {
		if (busy || previewing) return
		onClose()
	}

	const trackUrl = result?.txHash ? explorerTxUrl(result.txHash) : ''
	const remaining = preview ? available - preview.tx.amount - preview.fee : 0

	const formFooter = (
		<div className="sheet-footer">
			<div className="sheet-footer__info">
				<span>Tersedia</span>
				<strong className="mono">{formatNxc(available)} NXC</strong>
			</div>
			<button
				type="submit"
				form="send-sheet-form"
				className="button button--primary button--lg"
				disabled={busy || previewing}
			>
				{previewing ? 'Menghitung…' : 'Lanjut'}
			</button>
		</div>
	)

	const reviewFooter = (
		<div className="sheet-footer">
			<button
				type="button"
				className="button button--ghost button--lg"
				onClick={() => {
					setPreview(null)
					setStep('form')
				}}
				disabled={busy}
			>
				Kembali
			</button>
			<button
				type="button"
				className="button button--primary button--lg"
				onClick={() => void confirmSend()}
				disabled={busy}
			>
				{busy ? 'Mengirim…' : 'Kirim transaksi'}
			</button>
		</div>
	)

	const doneFooter = (
		<div className="sheet-footer">
			<button
				type="button"
				className="button button--primary button--lg"
				onClick={close}
			>
				Selesai
			</button>
		</div>
	)

	return (
		<Modal
			open={open}
			onClose={close}
			size="full"
			title={
				step === 'review'
					? 'Tinjau transaksi'
					: step === 'done'
						? 'Transaksi terkirim'
						: 'Kirim NXC'
			}
			actions={
				step === 'review'
					? reviewFooter
					: step === 'done'
						? doneFooter
						: formFooter
			}
		>
			{step === 'form' ? (
				<form
					id="send-sheet-form"
					className="sheet-form"
					onSubmit={(event) => void requestReview(event)}
				>
					{result && !result.ok ? (
						<Notice variant="error">{result.text}</Notice>
					) : null}

					<div className="send-amount">
						<label className="label" htmlFor="amount">
							Jumlah
						</label>
						<div className="send-amount__row">
							<input
								id="amount"
								className="send-amount__input"
								inputMode="decimal"
								placeholder="0"
								value={form.amountNxc}
								onChange={(event) => update({ amountNxc: event.target.value })}
							/>
							<span className="send-amount__unit">NXC</span>
							<button
								type="button"
								className="button button--secondary button--sm"
								onClick={() => void fillMax()}
								disabled={
									previewing || busy || !Number.isSafeInteger(available)
								}
							>
								Maks
							</button>
						</div>
						{touched && errors.amount ? (
							<p className="input-error">{errors.amount}</p>
						) : null}
						{touched && errors.fee ? (
							<p className="input-error">{errors.fee}</p>
						) : null}
						<p className="input-hint">
							Tersedia {formatNxc(available)} NXC. Biaya jaringan dihitung
							otomatis dari ukuran transaksi.
						</p>
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
							/**
							 * Alamat harus disalin apa adanya: autokoreksi/autokapital
							 * di HP bisa mengubah huruf sehingga alamat jadi tidak sah
							 * (dan salah ketik seperti itu tidak bisa dipulihkan).
							 */
							autoComplete="off"
							autoCorrect="off"
							autoCapitalize="characters"
							spellCheck={false}
						/>
						<button
							type="button"
							className="text-button"
							onClick={() => void pasteReceiver()}
						>
							<Icon name="copy" size={13} aria-hidden="true" />
							Tempel dari clipboard
						</button>
						{errors.receiver ? (
							<p className="input-error">{errors.receiver}</p>
						) : null}
						{pasteError ? <p className="input-error">{pasteError}</p> : null}
						{!touched || errors.receiver ? (
							<p className="input-hint">
								Alamat diawali NxC dan terdiri dari 43 karakter.
							</p>
						) : null}
					</div>

					{noteOpen || message ? (
						<div className="field">
							<label className="label" htmlFor="message">
								Catatan publik (opsional)
							</label>
							<input
								id="message"
								className="input"
								maxLength={100}
								placeholder="mis. Hadiah ulang tahun"
								value={message}
								onChange={(event) => setMessage(event.target.value)}
								autoFocus
							/>
						</div>
					) : (
						<button
							type="button"
							className="text-button"
							onClick={() => setNoteOpen(true)}
						>
							+ Tambah catatan
						</button>
					)}

					<p className="safety-note">
						<Icon name="lock" size={14} aria-hidden="true" />
						<span>
							Private key dipakai di perangkat ini dan tidak pernah dikirim ke
							node.
						</span>
					</p>
				</form>
			) : null}

			{step === 'review' && preview ? (
				<div className="sheet-form">
					<div className="review-list">
						<div>
							<span>Dari</span>
							<strong className="mono tx-hash">{sender}</strong>
						</div>
						<div>
							<span>Ke</span>
							<strong className="mono tx-hash">{preview.tx.receiver}</strong>
						</div>
						<div>
							<span>Jumlah</span>
							<strong className="mono">
								{formatNxcExact(preview.tx.amount)} NXC
							</strong>
						</div>
						<div>
							<span>Biaya jaringan</span>
							<strong className="mono">
								{formatNxcExact(preview.fee)} NXC
							</strong>
						</div>
						<div>
							<span>Total</span>
							<strong className="mono">
								{formatNxcExact(preview.tx.amount + preview.fee)} NXC
							</strong>
						</div>
						<div>
							<span>Sisa saldo</span>
							<strong className="mono">{formatNxcExact(remaining)} NXC</strong>
						</div>
						<div>
							<span>Nonce</span>
							<strong>#{preview.tx.nonce}</strong>
						</div>
						{message.trim() ? (
							<div>
								<span>Catatan</span>
								<strong>{message}</strong>
							</div>
						) : null}
					</div>
					<Notice variant="warn">
						Transaksi sudah ditandatangani di perangkat ini. Setelah dikirim,
						isinya tidak bisa dibatalkan atau diubah.
					</Notice>
				</div>
			) : null}

			{step === 'done' ? (
				<div className="sheet-form">
					<div className="send-done">
						<span className="send-done__icon">
							<Icon name="check" size={24} aria-hidden="true" />
						</span>
						{sent ? (
							<>
								<p className="send-done__amount">
									−{formatNxcExact(sent.amount)} NXC
								</p>
								<p className="send-done__to mono">ke {sent.receiver}</p>
							</>
						) : null}
						<p className="muted">{result?.text}</p>
					</div>
					{result?.txHash ? (
						<div className="result-hash">
							<code>{result.txHash}</code>
							<CopyButton
								text={result.txHash}
								ariaLabel="Salin hash transaksi"
								variant="plain"
							/>
						</div>
					) : null}
					<div className="send-done__actions">
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
						<button
							type="button"
							className="text-button"
							onClick={() => {
								setStep('form')
								setSent(null)
								setResult(null)
							}}
						>
							Kirim lagi
						</button>
					</div>
				</div>
			) : null}
		</Modal>
	)
}
