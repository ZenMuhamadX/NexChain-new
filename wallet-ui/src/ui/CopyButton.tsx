import { useCallback, useState } from 'react'
import { copyText } from '../lib/format'
import { Icon } from './Icon'
import type { IconName } from './Icon'

interface CopyButtonProps {
	text: string
	ariaLabel?: string
	size?: number
	className?: string
	onCopied?: () => void
	variant?: 'primary' | 'secondary' | 'ghost' | 'plain'
	children?: React.ReactNode
}

export const CopyButton = ({
	text,
	ariaLabel = 'Salin',
	size = 15,
	className = '',
	onCopied,
	variant = 'ghost',
	children,
}: CopyButtonProps): React.JSX.Element => {
	const [copied, setCopied] = useState(false)
	const [failed, setFailed] = useState(false)

	const handleCopy = useCallback(async () => {
		const ok = await copyText(text)
		setFailed(!ok)
		if (!ok) return
		setCopied(true)
		onCopied?.()
		window.setTimeout(() => setCopied(false), 1800)
	}, [text, onCopied])

	const icon: IconName = copied ? 'check' : 'copy'
	const label = copied ? 'Tersalin' : failed ? 'Gagal' : 'Salin'

	return (
		<button
			type="button"
			className={`copy-button copy-button--${variant} ${className}`.trim()}
			onClick={() => void handleCopy()}
			aria-label={copied ? 'Tersalin' : ariaLabel}
			title={failed ? 'Clipboard tidak tersedia' : label}
		>
			<Icon name={icon} size={size} aria-hidden="true" />
			<span>{children ?? label}</span>
		</button>
	)
}
