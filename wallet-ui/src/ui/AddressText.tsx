/**
 * AddressText — tampilkan alamat dengan middle-truncate (Nx1abc…9f2e).
 * Klik → tampilkan penuh, klik lagi → truncate.
 * Bisa dikombinasikan dengan CopyButton.
 */
import { useState } from 'react'
import { truncate } from '../lib/format'
import { Icon } from './Icon'
import type { IconName } from './Icon'

interface AddressTextProps {
	/** Alamat penuh */
	address: string
	/** Karakter depan (default 6) */
	head?: number
	/** Karakter belakang (default 4) */
	tail?: number
	/** Class tambahan */
	className?: string
	/** Callback saat diklik (toggle expand) */
	onClick?: () => void
	/** Tooltip/title saat truncate */
	title?: string
}

export const AddressText = ({
	address,
	head = 6,
	tail = 4,
	className = '',
	onClick,
	title,
}: AddressTextProps): React.JSX.Element => {
	const [expanded, setExpanded] = useState(false)

	const display =
		expanded || address.length <= head + tail + 1
			? address
			: truncate(address, head, tail)

	const handleClick = () => {
		setExpanded((v) => !v)
		onClick?.()
	}

	return (
		<code
			className={`mono ${className}`}
			onClick={handleClick}
			style={{
				cursor:
					onClick || address.length > head + tail + 1 ? 'pointer' : 'default',
				userSelect: 'all',
				display: 'inline-flex',
				alignItems: 'center',
				gap: 'var(--space-1)',
				fontSize: 'var(--text-sm)',
				color: 'var(--text-dim)',
				transition: 'color var(--transition-fast)',
			}}
			title={
				title ??
				(expanded ? 'Klik untuk mempersingkat' : 'Klik untuk melihat penuh')
			}
			role={onClick || address.length > head + tail + 1 ? 'button' : undefined}
			tabIndex={onClick || address.length > head + tail + 1 ? 0 : undefined}
			onKeyDown={(e) => {
				if (
					(e.key === 'Enter' || e.key === ' ') &&
					(onClick || address.length > head + tail + 1)
				) {
					e.preventDefault()
					handleClick()
				}
			}}
			aria-expanded={expanded}
			aria-label={
				expanded ? `Alamat penuh: ${address}` : `Alamat disingkat: ${display}`
			}
		>
			{display}
			{address.length > head + tail + 1 && (
				<Icon
					name={expanded ? 'eyeOff' : 'eye'}
					size={13}
					aria-hidden="true"
					style={{
						color: 'var(--muted)',
						flexShrink: 0,
						opacity: expanded ? 0.7 : 0.5,
					}}
				/>
			)}
		</code>
	)
}
