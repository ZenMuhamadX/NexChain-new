import type { ReactNode } from 'react'

export type IconName =
	| 'send'
	| 'receive'
	| 'qr'
	| 'home'
	| 'homeFilled'
	| 'history'
	| 'refresh'
	| 'external'
	| 'settings'
	| 'eye'
	| 'eyeOff'
	| 'copy'
	| 'close'
	| 'check'
	| 'lock'
	| 'alert'

const PATHS: Record<IconName, ReactNode> = {
	send: <path d="M4 12h16M14 6l6 6-6 6" />,
	receive: <path d="M20 12H4M10 6l-6 6 6 6" />,
	qr: (
		<>
			<rect x="3" y="3" width="7" height="7" rx="1.5" />
			<rect x="14" y="3" width="7" height="7" rx="1.5" />
			<rect x="3" y="14" width="7" height="7" rx="1.5" />
			<rect x="14" y="14" width="3" height="3" rx="0.5" />
			<path d="M20 14v3m-3 4h3" />
		</>
	),
	home: (
		<>
			<path d="M4 11 12 4l8 7" />
			<path d="M6.5 10v9h11v-9" />
		</>
	),
	homeFilled: (
		<path
			d="M12 3 3.5 10.5H6V20h12v-9.5h2.5L12 3Z"
			fill="currentColor"
			stroke="none"
		/>
	),
	history: (
		<>
			<path d="M4 12a8 8 0 1 0 2.4-5.7" />
			<path d="M4 4.5V9h4.5" />
			<path className="clock-hands" d="M12 7.5V12l3 2" />
		</>
	),
	refresh: (
		<g className="refresh-wheel">
			<path d="M21 12a9 9 0 0 1-15.4 6.3L3 16" />
			<path d="M3 21v-5h5" />
			<path d="M3 12a9 9 0 0 1 15.4-6.3L21 8" />
			<path d="M21 3v5h-5" />
		</g>
	),
	external: (
		<>
			<path d="M13 5h6v6" />
			<path d="M19 5 11 13" />
			<path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
		</>
	),
	settings: (
		<g className="gear-wheel">
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
			<circle cx="12" cy="12" r="3" />
		</g>
	),
	eye: (
		<>
			<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
			<circle cx="12" cy="12" r="2.5" />
		</>
	),
	eyeOff: (
		<>
			<path d="M4 4l16 16" />
			<path d="M9.5 6.8A9.6 9.6 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a15 15 0 0 1-3 3.3M6.2 8.4A15 15 0 0 0 2.5 12S6 17.5 12 17.5c1 0 2-.2 2.8-.5" />
		</>
	),
	copy: (
		<>
			<rect x="9" y="9" width="11" height="11" rx="2.5" />
			<path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" />
		</>
	),
	close: <path d="M6 6l12 12M18 6 6 18" />,
	check: (
		<>
			<path pathLength={1} d="m5 12.5 4.5 4.5" />
			<path pathLength={1} d="M9.5 17 19 7.5" />
		</>
	),
	lock: (
		<>
			<rect x="5" y="10.5" width="14" height="9.5" rx="3" />
			<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
		</>
	),
	alert: (
		<>
			<path d="M12 4 21 19.5H3L12 4Z" />
			<path d="M12 10v4.5M12 17.2v.3" />
		</>
	),
}

export const Icon = ({
	name,
	size = 20,
	className,
}: {
	name: IconName
	size?: number
	className?: string
}) => (
	<svg
		className={className}
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.7"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		focusable="false"
	>
		{PATHS[name]}
	</svg>
)
