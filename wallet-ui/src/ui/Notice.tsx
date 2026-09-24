/**
 * Notice — komponen pesan terpadu (error/ok/warn/info).
 * Ganti 3 gaya lama: .banner, .notice, .ok/.error polos.
 * Mendukung aksi (retry/dismiss) + aria-live untuk a11y.
 */
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type NoticeVariant = 'error' | 'ok' | 'warn' | 'info';

interface NoticeProps {
	variant: NoticeVariant;
	children: React.ReactNode;
	/** Aksi opsional (mis. tombol "Coba lagi") */
	action?: {
		label: string;
		onClick: () => void;
		/** true = variant danger */
		destructive?: boolean;
	};
	/** Tombol tutup (dismiss) */
	onDismiss?: () => void;
	/** Lebar penuh (default true di card) */
	fullWidth?: boolean;
	/** Optional id for aria-describedby */
	id?: string;
}

const variantMap: Record<NoticeVariant, { bg: string; border: string; color: string; icon: IconName }> = {
	error: {
		bg: 'rgba(242, 109, 109, 0.08)',
		border: 'rgba(242, 109, 109, 0.3)',
		color: 'var(--danger)',
		icon: 'lock'
	},
	ok: {
		bg: 'rgba(95, 211, 154, 0.08)',
		border: 'rgba(95, 211, 154, 0.28)',
		color: 'var(--ok)',
		icon: 'check'
	},
	warn: {
		bg: 'rgba(224, 177, 82, 0.08)',
		border: 'rgba(224, 177, 82, 0.3)',
		color: 'var(--warn)',
		icon: 'clock'
	},
	info: {
		bg: 'rgba(139, 149, 255, 0.08)',
		border: 'rgba(139, 149, 255, 0.28)',
		color: 'var(--accent)',
		icon: 'diamond'
	}
};

export const Notice = ({
	variant,
	children,
	action,
	onDismiss,
	fullWidth = true,
	id
}: NoticeProps): React.JSX.Element => {
	const { bg, border, color, icon } = variantMap[variant];

	return (
		<div
			id={id}
			role="alert"
			style={{
				background: bg,
				border: `1px solid ${border}`,
				color,
				borderRadius: 'var(--radius-md)',
				padding: 'var(--space-2) var(--space-3)',
				fontSize: 'var(--text-sm)',
				display: 'flex',
				alignItems: 'flex-start',
				gap: 'var(--space-2)',
				width: fullWidth ? '100%' : 'auto',
				boxSizing: 'border-box'
			}}
		>
			<Icon name={icon} size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
			<div style={{ flex: 1, minWidth: 0 }}>{children}</div>
			{action && (
				<button
					type="button"
					className={action.destructive ? 'danger' : 'ghost'}
					onClick={action.onClick}
					style={{ flexShrink: 0, marginLeft: 'var(--space-2)' }}
				>
					{action.label}
				</button>
			)}
			{onDismiss && (
				<button
					type="button"
					className="ghost"
					onClick={onDismiss}
					aria-label="Tutup"
					style={{ flexShrink: 0, marginLeft: 'var(--space-1)', padding: 'var(--space-1)' }}
				>
					<Icon name="lock" size={14} style={{ transform: 'rotate(45deg)' }} />
				</button>
			)}
		</div>
	);
};