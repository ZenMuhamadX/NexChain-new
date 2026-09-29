import { useState } from 'react'
import {
	formatNxcCompact,
	formatNxcDisplay,
	formatNxcExact,
	formatNexu,
} from '../lib/format'
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

/**
 * Jumlah ringkas dengan disclosure presisi penuh.
 *
 * DUA representasi dengan peran berbeda:
 *   - `display` (dengan pemisah ribuan) → yang DILIHAT pengguna. `1.234.567,89`
 *     jauh lebih cepat diverifikasi mata daripada `1234567.89`.
 *   - `exact` (presisi penuh, tanpa pemisah) → yang dapat DIPILIH/DISALIN di
 *     dialog detail. Nilai ini yang boleh dipakai ulang; menyalin versi
 *     ber-pemisah akan menghasilkan string yang bukan angka.
 */
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
	const display = formatNxcDisplay(nexu)
	const compact = formatNxcCompact(nexu)
	const exact = formatNxcExact(nexu)
	const raw = formatNexu(nexu)

	return (
		<span className={`amount-display amount-display--${size} ${className}`.trim()}>
			<span className="amount-display__value">
				{display}
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
					<button
						type="button"
						className="button button--primary"
						onClick={() => setOpen(false)}
					>
						Tutup
					</button>
				}
			>
				<div className="amount-detail">
					<span className="amount-detail__label">Tampilan ringkas</span>
					<strong className="mono">
						{display} NXC
					</strong>
					<span className="amount-detail__label">NXC presisi penuh</span>
					<strong className="mono">{exact} NXC</strong>
					<span className="amount-detail__label">Nilai internal</span>
					<strong className="mono">{raw}</strong>
					<p>1 NXC = 1.000.000.000.000.000.000 nexu</p>
				</div>
			</Modal>
		</span>
	)
}
