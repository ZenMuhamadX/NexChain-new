import { Icon } from './Icon'
import type { IconName } from './Icon'

export type NoticeVariant = 'error' | 'ok' | 'warn' | 'info'

interface NoticeProps {
	variant: NoticeVariant
	children: React.ReactNode
	action?: {
		label: string
		onClick: () => void
		destructive?: boolean
	}
	onDismiss?: () => void
	fullWidth?: boolean
	id?: string
}

/**
 * Ikon per varian. Sebelumnya semua memakai ikon yang "kebetulan ada"
 * (error = gembok, info = berlian) sehingga pesan galat tampak seperti
 * pengingat keamanan. Sekarang tiap varian memakai ikon yang menyatakan
 * tingkat kepentingannya sendiri.
 */
const variantMap: Record<NoticeVariant, { icon: IconName }> = {
	error: { icon: 'alert' },
	ok: { icon: 'check' },
	warn: { icon: 'alert' },
	info: { icon: 'info' },
}

export const Notice = ({
	variant,
	children,
	action,
	onDismiss,
	fullWidth = true,
	id,
}: NoticeProps): React.JSX.Element => {
	const { icon } = variantMap[variant]
	return (
		<div
			id={id}
			className={`notice notice--${variant} ${fullWidth ? 'notice--full' : ''}`}
			role={variant === 'error' ? 'alert' : 'status'}
		>
			<Icon name={icon} size={16} aria-hidden="true" />
			<div className="notice__content">{children}</div>
			{action ? (
				<button
					type="button"
					className={`button button--sm ${action.destructive ? 'button--danger' : 'button--ghost'}`}
					onClick={action.onClick}
				>
					{action.label}
				</button>
			) : null}
			{onDismiss ? (
				<button type="button" className="icon-button" onClick={onDismiss} aria-label="Tutup pesan">
					×
				</button>
			) : null}
		</div>
	)
}
