import { useEffect, useRef, useState } from 'react'

type CopyState = 'idle' | 'ok' | 'failed'

/**
 * Tombol copy dengan umpan balik yang benar.
 *
 * Dua perbaikan dari audit:
 * 1. Dulu kegagalan clipboard ditelan `catch {}` ("biarkan diam") → user
 *    klik berulang tanpa tahu apa yang terjadi. Sekarang ada state `failed`.
 * 2. Target ~18px → di bawah minimum 24×24px (WCAG 2.2 SC 2.5.8); kini
 *    diatur lewat CSS `.copy-btn` (min 1.5rem).
 *
 * Perubahan status juga diumumkan lewat region `role="status"` karena
 * perubahan teks tombol saja tidak di-announce screen reader.
 */
export function CopyButton({
	value,
	label = 'Copy',
}: {
	value: string
	label?: string
}) {
	const [state, setState] = useState<CopyState>('idle')
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current)
		},
		[],
	)

	const scheduleReset = () => {
		if (timer.current) clearTimeout(timer.current)
		timer.current = setTimeout(() => setState('idle'), 1800)
	}

	const copy = async () => {
		let ok = false

		try {
			await navigator.clipboard.writeText(value)
			ok = true
		} catch {
			ok = false
		}

		// Fallback: Clipboard API ditolak (konteks non-HTTPS, iframe, browser lama).
		if (!ok) {
			try {
				const area = document.createElement('textarea')
				area.value = value
				area.setAttribute('readonly', '')
				area.style.position = 'fixed'
				area.style.top = '-1000px'
				area.style.opacity = '0'
				document.body.appendChild(area)
				area.select()
				ok = document.execCommand('copy')
				document.body.removeChild(area)
			} catch {
				ok = false
			}
		}

		setState(ok ? 'ok' : 'failed')
		scheduleReset()
	}

	const text =
		state === 'ok' ? '✓ copied' : state === 'failed' ? '✕ failed' : '⧉ copy'
	const className =
		state === 'ok'
			? 'copy-btn copy-btn-ok'
			: state === 'failed'
				? 'copy-btn copy-btn-failed'
				: 'copy-btn'

	return (
		<>
			<button
				type="button"
				className={className}
				onClick={() => void copy()}
				title={`${label}: ${value}`}
				aria-label={`${label}: ${value}`}
			>
				{text}
			</button>
			<span className="sr-only" role="status">
				{state === 'ok'
					? `${label} succeeded`
					: state === 'failed'
						? `${label} failed`
						: ''}
			</span>
		</>
	)
}
