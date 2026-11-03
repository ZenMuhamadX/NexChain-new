import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ModalVariant = 'default' | 'danger'

interface ModalProps {
	open: boolean
	onClose: () => void
	title: string
	/** Label kecil di atas judul. Kosong = tidak dirender (dialog informasi). */
	eyebrow?: string
	children: React.ReactNode
	actions?: React.ReactNode
	variant?: ModalVariant
	confirmText?: string
	confirmLabel?: string
	onConfirm?: () => void | Promise<void>
	confirmLoading?: boolean
	size?: 'sm' | 'md' | 'lg' | 'full'
}

const sizeClass = {
	sm: 'modal--sm',
	md: 'modal--md',
	lg: 'modal--lg',
	full: 'modal--full',
}

/**
 * Dialog yang sedang terbuka, urut dari yang paling awal.
 *
 * `Escape` dan kunci scroll hanya milik dialog TERATAS: rincian jumlah di
 * dalam sheet Kirim tidak boleh menutup dua-duanya sekaligus.
 */
const dialogStack: symbol[] = []

export const Modal = ({
	open,
	onClose,
	title,
	eyebrow,
	children,
	actions,
	variant = 'default',
	confirmText,
	confirmLabel = 'Konfirmasi',
	onConfirm,
	confirmLoading = false,
	size = 'md',
}: ModalProps): React.JSX.Element | null => {
	const titleId = useId()
	const dialogRef = useRef<HTMLDivElement>(null)
	const previousFocus = useRef<HTMLElement | null>(null)
	const dialogId = useRef(Symbol('dialog'))
	const onCloseRef = useRef(onClose)
	onCloseRef.current = onClose
	const [confirmValue, setConfirmValue] = useState('')
	const confirmMet = !confirmText || confirmValue === confirmText

	/**
	 * Reset HANYA saat dialog dibuka — bukan di efek utama.
	 *
	 * Efek utama bergantung pada `onClose`, yang dibuat ulang tiap render
	 * pemanggil; mereset di sana akan menghapus ketikan user di tengah jalan.
	 * Tanpa reset, gerbang "ketik HAPUS" hanya perlu dilalui sekali: nilai
	 * lama tetap tersimpan saat dialog ditutup dan dibuka lagi.
	 */
	useEffect(() => {
		if (open) setConfirmValue('')
	}, [open])

	/**
	 * `onClose` dibaca dari ref, dan dependensi hanya `[open]`.
	 *
	 * Kalau `onClose` ikut jadi dependensi, efek ini dibongkar-pasang setiap
	 * render pemanggil (closure `() => setAction(null)` selalu baru), dan
	 * cleanup-nya memindahkan fokus keluar dari input — satu huruf per klik.
	 */
	useEffect(() => {
		if (!open) return
		const id = dialogId.current
		dialogStack.push(id)
		previousFocus.current = document.activeElement as HTMLElement
		const timer = window.setTimeout(() => {
			// Utamakan kolom isian: tombol pertama di dialog biasanya "Tutup",
			// dan memfokuskannya membuat pengguna harus Tab sebelum mengetik.
			const auto =
				dialogRef.current?.querySelector<HTMLElement>(
					'input:not([type="hidden"]), textarea, select',
				) ??
				dialogRef.current?.querySelector<HTMLElement>(
					'button, [href], [tabindex]:not([tabindex="-1"])',
				)
			auto?.focus()
		}, 0)
		const isTop = (): boolean => dialogStack[dialogStack.length - 1] === id
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				if (!isTop()) return
				event.stopPropagation()
				onCloseRef.current()
				return
			}
			if (event.key !== 'Tab' || !dialogRef.current || !isTop()) return
			const focusable = Array.from(
				dialogRef.current.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				),
			).filter((element) => !element.hasAttribute('disabled'))
			if (focusable.length === 0) return
			const first = focusable[0]
			const last = focusable[focusable.length - 1]
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first.focus()
			}
		}
		document.addEventListener('keydown', onKeyDown)
		document.body.classList.add('modal-open')
		return () => {
			window.clearTimeout(timer)
			document.removeEventListener('keydown', onKeyDown)
			dialogStack.splice(dialogStack.indexOf(id), 1)
			// Dialog lain masih terbuka → scroll tetap terkunci.
			if (dialogStack.length === 0) document.body.classList.remove('modal-open')
			previousFocus.current?.focus()
		}
	}, [open])

	if (!open) return null

	const defaultActions = (
		<div className="modal-actions">
			<button
				type="button"
				className="button button--ghost"
				onClick={onClose}
				disabled={confirmLoading}
			>
				Batal
			</button>
			<button
				type="button"
				className={`button ${variant === 'danger' ? 'button--danger' : 'button--primary'}`}
				onClick={() => void onConfirm?.()}
				disabled={confirmLoading || !confirmMet || !onConfirm}
			>
				{confirmLoading ? 'Memproses…' : confirmLabel}
			</button>
		</div>
	)

	return createPortal(
		<div
			className={`modal-overlay ${size === 'full' ? 'modal-overlay--full' : ''}`}
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose()
			}}
		>
			<div
				ref={dialogRef}
				className={`modal ${sizeClass[size]} ${variant === 'danger' ? 'modal--danger' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<header className="modal-header">
					<div>
						{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
						<h2 id={titleId}>{title}</h2>
					</div>
					<button
						type="button"
						className="icon-button"
						onClick={onClose}
						aria-label="Tutup dialog"
					>
						<span aria-hidden="true">×</span>
					</button>
				</header>
				<div className="modal-body">
					{children}
					{confirmText ? (
						<div className="confirm-field">
							<label htmlFor="modal-confirm">
								Ketik <strong>{confirmText}</strong> untuk melanjutkan
							</label>
							<input
								id="modal-confirm"
								className="input mono"
								value={confirmValue}
								onChange={(event) => setConfirmValue(event.target.value)}
								autoComplete="off"
							/>
							<p className={confirmMet ? 'field-success' : 'input-hint'}>
								{confirmMet ? 'Konfirmasi cocok.' : 'Belum cocok.'}
							</p>
						</div>
					) : null}
				</div>
				<footer className="modal-footer">{actions ?? defaultActions}</footer>
			</div>
		</div>,
		document.body,
	)
}
