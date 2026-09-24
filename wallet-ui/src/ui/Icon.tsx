/**
 * Ikon SVG inline (gaya stroke 24×24) — murni presentasi, tanpa logika.
 * Dipakai di topbar, tombol aksi, dan baris riwayat.
 */
export type IconName =
	| 'home'
	| 'arrowUpRight'
	| 'arrowDownLeft'
	| 'clock'
	| 'sliders'
	| 'lock'
	| 'copy'
	| 'check'
	| 'refresh'
	| 'diamond'
	| 'eye'
	| 'eyeOff'
	| 'trash'

const PATHS: Record<IconName, React.JSX.Element> = {
	home: (
		<>
			<path d="m3 10.5 9-7.5 9 7.5" />
			<path d="M5 9.5V21h14V9.5" />
			<path d="M10 21v-6h4v6" />
		</>
	),
	arrowUpRight: (
		<>
			<path d="M7 17 17 7" />
			<path d="M8 7h9v9" />
		</>
	),
	arrowDownLeft: (
		<>
			<path d="M17 7 7 17" />
			<path d="M16 17H7V8" />
		</>
	),
	clock: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7.5V12l3 1.8" />
		</>
	),
	sliders: (
		<>
			<path d="M4 7h6" />
			<path d="M14 7h6" />
			<circle cx="12" cy="7" r="2" />
			<path d="M4 17h6" />
			<path d="M14 17h6" />
			<circle cx="12" cy="17" r="2" />
		</>
	),
	lock: (
		<>
			<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
			<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
		</>
	),
	copy: (
		<>
			<rect x="9" y="9" width="12" height="12" rx="2.5" />
			<path d="M5.5 15h-.5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2H13a2 2 0 0 1 2 2V6" />
		</>
	),
	check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
	refresh: (
		<>
			<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
			<path d="M21 3v5h-5" />
		</>
	),
	diamond: <path d="M12 3.2 20.8 12 12 20.8 3.2 12Z" />,
	eye: (
		<>
			<path d="M2.5 12S6.5 5.5 12 5.5 21.5 12 21.5 12 17.5 18.5 12 18.5 2.5 12 2.5 12Z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
	eyeOff: (
		<>
			<path d="M3 3l18 18" />
			<path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c5.5 0 9.5 6 9.5 6a18.3 18.3 0 0 1-3.4 4.1" />
			<path d="M6.6 7.7C3.9 9.5 2.5 12 2.5 12s4 6.5 9.5 6.5a10.4 10.4 0 0 0 4-.8" />
			<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
		</>
	),
	trash: (
		<>
			<path d="M4.5 7h15" />
			<path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
			<path d="M6.8 7l.8 12a2 2 0 0 0 2 1.9h4.8a2 2 0 0 0 2-1.9l.8-12" />
			<path d="M10.5 11v6" />
			<path d="M13.5 11v6" />
		</>
	),
}

interface IconProps {
	name: IconName
	size?: number
	className?: string
}

export const Icon = ({ name, size = 16, className }: IconProps): React.JSX.Element => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.75}
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		focusable="false"
		className={className}
	>
		{PATHS[name]}
	</svg>
)
