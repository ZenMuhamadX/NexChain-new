/**
 * CopyButton — tombol salin dengan feedback visual + aria-live.
 * Dipakai di Receive, Settings, Dashboard, History detail.
 */
import { useState, useCallback } from 'react'
import { copyText } from '../lib/format'
import { Icon } from './Icon'
import type { IconName } from './Icon'

interface CopyButtonProps {
	/** Teks yang akan disalin */
	text: string
	/** Label aksesibilitas */
	ariaLabel?: string
	/** Ukuran ikon */
	size?: number
	/** Class tambahan */
	className?: string
	/** Callback setelah salin berhasil */
	onCopied?: () => void
	/** Variant tombol */
	variant?: 'primary' | 'ghost' | 'plain'
	/** Teks tombol (default: ikon saja) */
	children?: React.ReactNode
}

export const CopyButton = ({
	text,
	ariaLabel = 'Salin alamat',
	size = 16,
	className = '',
	variant = 'ghost',
	children,
	onCopied,
}: CopyButtonProps): React.JSX.Element => {
	const [copied, setCopied] = useState(false)
	const [announcement, setAnnouncement] = useState('')

	const handleCopy = useCallback(async () => {
		const ok = await copyText(text)
		if (ok) {
			setCopied(true)
			setAnnouncement('Tersalin ke clipboard')
			onCopied?.()
			setTimeout(() => {
				setCopied(false)
				setAnnouncement('')
			}, 2000)
		} else {
			setAnnouncement('Gagal menyalin')
		}
	}, [text, onCopied])

	const baseButtonClass = `inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`
	const variantClass =
		variant === 'primary'
			? 'bg-text text-bg font-semibold hover:bg-white'
			: variant === 'ghost'
				? 'bg-transparent text-muted hover:bg-hover hover:text-text'
				: 'bg-transparent text-muted hover:text-text'

	return (
		<>
			<div
				aria-live="polite"
				aria-atomic="true"
				className="sr-only"
				style={{
					position: 'absolute',
					width: '1px',
					height: '1px',
					overflow: 'hidden',
				}}
			>
				{announcement}
			</div>
			<button
				type="button"
				className={`${baseButtonClass} ${variantClass} ${className}`}
				onClick={handleCopy}
				aria-label={copied ? 'Tersalin' : ariaLabel}
				disabled={copied}
			>
				{children ?? (
					<Icon
						name={copied ? 'check' : 'copy'}
						size={size}
						aria-hidden="true"
					/>
				)}
				{!children && copied && (
					<span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
						Tersalin
					</span>
				)}
			</button>
		</>
	)
}
