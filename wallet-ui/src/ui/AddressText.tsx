import { useState } from 'react'
import { truncate } from '../lib/format'
import { Icon } from './Icon'

interface AddressTextProps {
	address: string
	head?: number
	tail?: number
	className?: string
	onClick?: () => void
	title?: string
}

export const AddressText = ({
	address,
	head = 8,
	tail = 6,
	className = '',
	onClick,
	title,
}: AddressTextProps): React.JSX.Element => {
	const [expanded, setExpanded] = useState(false)
	const canExpand = address.length > head + tail + 1
	const display = expanded || !canExpand ? address : truncate(address, head, tail)

	const handleClick = () => {
		if (!canExpand && !onClick) return
		setExpanded((value) => !value)
		onClick?.()
	}

	return (
		<code
			className={`address-text ${className}`.trim()}
			onClick={handleClick}
			onKeyDown={(event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return
				event.preventDefault()
				handleClick()
			}}
			role={canExpand || onClick ? 'button' : undefined}
			tabIndex={canExpand || onClick ? 0 : undefined}
			aria-expanded={canExpand ? expanded : undefined}
			aria-label={
				expanded ? `Alamat lengkap: ${address}` : `Alamat ringkas: ${display}`
			}
			title={title ?? (expanded ? 'Klik untuk menyingkat' : 'Klik untuk melihat penuh')}
		>
			<span>{display}</span>
			{canExpand ? (
				<Icon name={expanded ? 'eyeOff' : 'eye'} size={13} aria-hidden="true" />
			) : null}
		</code>
	)
}
