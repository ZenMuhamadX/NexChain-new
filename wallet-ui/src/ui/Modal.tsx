/**
 * Modal — dialog aksesibel (role="dialog", aria-modal, focus trap, ESC tutup).
 * Variant "danger" untuk aksi destruktif (wipe) + mode "ketik untuk konfirmasi".
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type ModalVariant = 'default' | 'danger';

interface ModalProps {
	/** Terbuka/tutup */
	open: boolean;
	/** Dipanggil saat user klik backdrop, tekan ESC, atau klik tombol batal */
	onClose: () => void;
	/** Judul dialog */
	title: string;
	/** Konten (bisa JSX) */
	children: React.ReactNode;
	/** Footer actions (default: Batal + Konfirmasi) */
	actions?: React.ReactNode;
	/** Variant visual */
	variant?: ModalVariant;
	/** Mode konfirmasi ketik: string yang harus diketik user untuk mengaktifkan aksi utama */
	confirmText?: string;
	/** Label tombol aksi utama */
	confirmLabel?: string;
	/** Handler aksi utama (hanya aktif jika confirmText terpenuhi / tidak ada confirmText) */
	onConfirm?: () => void | Promise<void>;
	/** Apakah aksi utama loading */
	confirmLoading?: boolean;
	/** Ukuran modal */
	size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
	sm: '360px',
	md: '480px',
	lg: '580px'
};

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
	size = 'md'
}: ModalProps): React.JSX.Element | null => {
	const overlayRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const previousActiveElement = useRef<HTMLElement | null>(null);
	const [confirmValue, setConfirmValue] = useState('');
	const confirmMet = !confirmText || confirmValue === confirmText;

	// Focus trap + restore focus on close
	useEffect(() => {
		if (open) {
			previousActiveElement.current = document.activeElement as HTMLElement;
			// Trap focus: tunggu render lalu fokus ke elemen pertama yang bisa difokuskan
			setTimeout(() => {
				const focusable = contentRef.current?.querySelector<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
				);
				focusable?.focus();
			}, 0);
		} else if (previousActiveElement.current) {
			previousActiveElement.current.focus();
		}
	}, [open]);

	// Handle ESC
	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if (e.key === 'Escape' && open) {
			onClose();
		}
	}, [open, onClose]);

	useEffect(() => {
		if (open) {
			document.addEventListener('keydown', handleKeyDown);
			document.body.style.overflow = 'hidden';
		}
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.body.style.overflow = '';
		};
	}, [open, handleKeyDown]);

	if (!open) return null;

	const isDanger = variant === 'danger';
	const confirmDisabled = confirmLoading || !confirmMet || !onConfirm;

	const defaultActions = (
		<div className="row end" style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border)' }}>
			<button className="ghost" onClick={onClose} disabled={confirmLoading}>
				Batal
			</button>
			<button
				className={isDanger ? 'danger' : 'primary'}
				onClick={() => onConfirm?.()}
				disabled={confirmDisabled}
			>
				{confirmLoading ? 'Memproses…' : confirmLabel}
			</button>
		</div>
	);

	const modalContent = (
		<div
			className="modal-overlay"
			ref={overlayRef}
			onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0, 0, 0, 0.6)',
				backdropFilter: 'blur(4px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: 'var(--space-4)',
				zIndex: 100,
				animation: 'fade-in 0.2s ease'
			}}
			role="presentation"
		>
			<div
				ref={contentRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="modal-title"
				style={{
					background: 'var(--bg-raised)',
					border: '1px solid var(--border)',
					borderRadius: 'var(--radius-lg)',
					width: '100%',
					maxWidth: sizeMap[size],
					maxHeight: '85vh',
					overflow: 'hidden',
					display: 'flex',
					flexDirection: 'column',
					boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
					animation: 'fade-in 0.2s ease'
				}}
			>
				{isDanger && (
					<div style={{ height: 3, background: 'linear-gradient(90deg, var(--danger), #ff9999)' }} />
				)}
				<div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', borderBottom: '1px solid var(--border)' }}>
					<h2 id="modal-title" style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--font-weight-semibold)' }}>
						{title}
					</h2>
					<button
						type="button"
						className="ghost"
						onClick={onClose}
						disabled={confirmLoading}
						aria-label="Tutup"
						style={{ padding: 'var(--space-1)' }}
					>
						<Icon name="lock" size={18} style={{ transform: 'rotate(45deg)' }} />
					</button>
				</div>
				<div style={{ padding: 'var(--space-4) var(--space-5)', overflow: 'auto', flex: 1 }}>
					{children}
					{confirmText && (
						<div style={{ marginTop: 'var(--space-4)' }}>
							<label style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-2)' }}>
								Ketik <strong>"{confirmText}"</strong> untuk konfirmasi:
							</label>
							<input
								type="text"
								value={confirmValue}
								onChange={(e) => setConfirmValue(e.target.value)}
								placeholder={confirmText}
								style={{
									width: '100%',
									background: 'var(--bg-input)',
									border: '1px solid var(--border)',
									borderRadius: 'var(--radius-sm)',
									color: 'var(--text)',
									padding: 'var(--space-2) var(--space-3)',
									fontSize: 'var(--text-base)',
									fontFamily: 'var(--mono)',
									outline: 'none'
								}}
								aria-describedby="confirm-hint"
							/>
							<p id="confirm-hint" style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: confirmMet ? 'var(--ok)' : 'var(--muted)' }}>
								{confirmMet ? '✓ Cocok' : 'Belum cocok'}
							</p>
						</div>
					)}
				</div>
				<div style={{ padding: 'var(--space-3) var(--space-5)', borderTop: '1px solid var(--border)' }}>
					{actions ?? defaultActions}
				</div>
			</div>
		</div>
	);

	return createPortal(modalContent, document.body);
};