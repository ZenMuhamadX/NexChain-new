type Tone = 'accent' | 'success' | 'warn' | 'danger' | 'muted'

export const Stat = ({
	label,
	value,
	hint,
	tone,
}: {
	label: string
	value: string
	hint?: string
	tone?: Tone
}) => (
	<div className="stat">
		<span className="stat-label">{label}</span>
		<span className={tone ? `stat-value tone-${tone}` : 'stat-value'}>
			{value}
		</span>
		{hint ? <span className="stat-hint">{hint}</span> : null}
	</div>
)
