import type { ReactNode } from 'react'

export function StatCard({
	label,
	value,
	hint,
	accent = false,
}: {
	label: string
	value: ReactNode
	hint?: ReactNode
	accent?: boolean
}) {
	return (
		<div className={`stat-card${accent ? ' stat-accent' : ''}`}>
			<p className="stat-label">{label}</p>
			<p className="stat-value">{value}</p>
			{hint ? <p className="stat-hint">{hint}</p> : null}
		</div>
	)
}
