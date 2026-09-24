import type { ReactNode } from 'react'

/**
 * Satuan nilai dengan penjelasan konversi on-demand.
 *
 * Hubungan `1 NXC = 10¹⁸ Nexu` dulu hanya hidup di komentar kode
 * (`lib/format.ts`), padahal user melihat keduanya berdampingan tanpa
 * tahu mana yang lebih besar. Tooltip ini bisa dibuka lewat hover
 * maupun keyboard (tabIndex + focus-visible).
 */
export function Unit({
	children,
	unit = 'nexu',
}: {
	children: ReactNode
	unit?: string
}) {
	return (
		<>
			{children}{' '}
			<span
				className="unit"
				tabIndex={0}
				role="note"
				aria-label={`${unit}. One NXC equals ten to the power of eighteen ${unit}.`}
			>
				{unit}
				<span className="tip" role="tooltip">
					1 NXC = 10¹⁸ {unit}
				</span>
			</span>
		</>
	)
}
