import { useState } from 'react'

export function CopyButton({
	value,
	label = 'Copy',
}: {
	value: string
	label?: string
}) {
	const [copied, setCopied] = useState(false)

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 1500)
		} catch {
			// Clipboard ditolak browser — biarkan diam.
		}
	}

	return (
		<button
			type="button"
			className={`copy-btn${copied ? ' copy-btn-ok' : ''}`}
			onClick={() => void copy()}
			title={`${label}: ${value}`}
			aria-label={label}
		>
			{copied ? '✓ copied' : '⧉ copy'}
		</button>
	)
}
