import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export type ModalVariant = 'default' | 'danger' | 'sheet'

interface ModalProps {
	open: boolean
	onClose: () => void
	title: string
	children: React.ReactNode
	actions?: React.ReactNode
	variant?: ModalVariant
	confirmText?: string
	confirmLabel?: string
	onConfirm?: () => void | Promise<void>
	confirmLoading?: boolean
	size?: 'sm' | 'md' | 'lg'
}

const sizeClass = { sm: 'modal--sm', md: 'modal--md', lg: 'modal--lg' }

/**
 * Dialog modal.
 *
 * Aksesibilitas yang ditangani:
 *   - fokus awal pindah ke elemen pertama di dalam dialog
 *   - Tab/Shift+Tab terkurung di dalam dialog (focus trap)
 *   - Escape menutup
 *   - klik pada overlay menutup
 *   - fokus dikembalikan ke elemen pemicu saat ditutup
 *
 * `variant='sheet'` menambatkan dialog ke bawah layar — pola bottom-sheet yang
 * lebih nyaman di popup sempit karena mendekatkan tombol konfirmasi ke jempol.
 */
export const Modal = ({
	open,
	onClose,
	title,
	children,
	actions,
	variant = 'default',
	confirmText,
	confirmLabel = 'Konfirmasi',
	onConfirm,
	confirmLoading = false,
	size = 'md',
}: ModalProps): React.JSX.Element | null => {
	const dialogRef = useRef<HTMLDivElement>(null)
	const previousFocus = useRef<HTMLElement | null>(null)
	const [confirmValue, setConfirmValue] = useState('')
	const confirmMet = !confirmText || confirmValue === confirmText

	/**
	 * Reset input konfirmasi setiap kali dialog dibuka. Tanpa ini, penghapusan
	 * pertama yang dibatalkan akan meninggalkan 'HAPUS' tertulis dan
	 * penghapusan berikutnya lolos tanpa diketik ulang.
	 */
	useEffect(() => {
		if (open) setConfirmValue('')
	}, [open])

	useEffect(() => {
		if (!open) return
		previousFocus.current = document.activeElement as HTMLElement
		const timer = window.setTimeout(() => {
			const first = dialogRef.current?.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			)
			first?.focus()
		}, 0)
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
			if (event.key !== 'Tab' || !dialogRef.current) return
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
			document.body.classList.remove('modal-open')
			previousFocus.current?.focus()
		}
	}, [open, onClose])

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
				className={`button ${
					variant === 'danger' ? 'button--danger' : 'button--primary'
				}`}
				onClick={() => void onConfirm?.()}
				disabled={confirmLoading || !confirmMet || !onConfirm}
			>
				{confirmLoading ? 'Memproses…' : confirmLabel}
			</button>
		</div>
	)

	return createPortal(
		<div
			className={`modal-overlay ${variant === 'sheet' ? 'modal-overlay--sheet' : ''}`}
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose()
			}}
		>
			<div
				ref={dialogRef}
				className={`modal ${sizeClass[size]} ${
					variant === 'danger' ? 'modal--danger' : ''
				} ${variant === 'sheet' ? 'modal--sheet' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="modal-title"
			>
				<header className="modal-header">
					<h2 id="modal-title">{title}</h2>
					<button
						type="button"
						className="icon-button icon-button--sm"
						onClick={onClose}
						aria-label="Tutup dialog"
					>
						<Icon name="close" size={16} aria-hidden="true" />
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
								className={`input mono ${confirmMet ? '' : 'input--invalid'}`}
								value={confirmValue}
								onChange={(event) => setConfirmValue(event.target.value)}
								autoComplete="off"
								spellCheck={false}
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
