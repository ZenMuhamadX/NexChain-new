import { useState } from 'react'
import { NEXU_PER_NXC } from 'src/core/token/constants'
import { formatNxcCompact, formatNxcExact, formatNexu } from '../lib/format'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface AmountDisplayProps {
	nexu: number
	className?: string
	size?: 'default' | 'large' | 'table' | 'inline'
	showUnit?: boolean
	showDetail?: boolean
	detailLabel?: string
	ariaLabel?: string
}

/** Compact amount with an optional exact-unit disclosure. */
export const AmountDisplay = ({
	nexu,
	className = '',
	size = 'default',
	showUnit = true,
	showDetail = true,
	detailLabel = 'Detail',
	ariaLabel = 'Lihat detail jumlah',
}: AmountDisplayProps): React.JSX.Element => {
	const [open, setOpen] = useState(false)
	const compact = formatNxcCompact(nexu)
	const exact = formatNxcExact(nexu)
	const raw = formatNexu(nexu)

	return (
		<span className={`amount-display amount-display--${size} ${className}`.trim()}>
			<span className="amount-display__value">
				{compact}
				{showUnit ? <span className="amount-display__unit">NXC</span> : null}
			</span>
			{showDetail ? (
				<button
					type="button"
					className="amount-display__detail"
					onClick={() => setOpen(true)}
					aria-label={`${ariaLabel}: ${compact} NXC`}
					aria-haspopup="dialog"
				>
					<span>{detailLabel}</span>
					<Icon name="arrowUpRight" size={11} aria-hidden="true" />
				</button>
			) : null}
			<Modal
				open={open}
				onClose={() => setOpen(false)}
				title="Detail jumlah"
				size="sm"
				actions={
					<button type="button" className="button button--primary" onClick={() => setOpen(false)}>
						Tutup
					</button>
				}
			>
				<div className="amount-detail">
					<span className="amount-detail__label">NXC presisi penuh</span>
					<strong className="mono">{exact} NXC</strong>
					<span className="amount-detail__label">Nilai internal</span>
					<strong className="mono">{raw} nexu</strong>
					<p>1 NXC = {NEXU_PER_NXC.toLocaleString('id-ID')} nexu</p>
				</div>
			</Modal>
		</span>
	)
}
