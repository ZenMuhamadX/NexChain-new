import type { ReactNode } from 'react'
import { NEXU_PER_NXC } from '../../lib/format'

/**
 * Satuan nilai dengan penjelasan konversi on-demand.
 *
 * Angka di tooltip ini HARUS mengikuti `NEXU_PER_NXC` — dulu ditulis
 * "1 NXC = 10¹⁸ Nexu" secara hardcoded, sisa dari satuan 18 desimal. Sejak
 * satuan dirombak ke 8 desimal (gaya satoshi) tooltip itu salah 10 miliar
 * kali lipat, padahal justru di situlah user belajar membaca nilai.
 *
 * Dibaca dari konstanta, bukan literal, supaya perubahan satuan tidak bisa
 * membuat tooltip ini berbohong lagi.
 */
export function Unit({
	children,
	unit = 'nexu',
}: {
	children: ReactNode
	unit?: string
}) {
	const perNxc = NEXU_PER_NXC.toLocaleString('en-US')

	return (
		<>
			{children}{' '}
			<span
				className="unit"
				tabIndex={0}
				role="note"
				aria-label={`${unit}. One NXC equals ${perNxc} ${unit}.`}
			>
				{unit}
				<span className="tip" role="tooltip">
					1 NXC = {perNxc} {unit}
				</span>
			</span>
		</>
	)
}
