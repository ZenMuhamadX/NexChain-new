import type { ReactNode } from 'react'
import { RpcClientError } from '../../api/rpcClient'

/** Pesan error yang manusiawi dari berbagai jenis error. */
export function errorMessage(error: unknown): string {
	if (error instanceof RpcClientError) return error.message
	if (error instanceof Error) return error.message
	return 'An unexpected error occurred.'
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
	return (
		<div className="state-block" role="status" aria-live="polite">
			<span className="spinner" aria-hidden="true" />
			<p className="state-message">{label}</p>
		</div>
	)
}

export function ErrorState({
	error,
	onRetry,
	title = 'Something went wrong',
}: {
	error: unknown
	onRetry?: () => void
	title?: string
}) {
	return (
		<div className="state-block state-error" role="alert">
			<p className="state-title">{title}</p>
			<p className="state-message">{errorMessage(error)}</p>
			{onRetry ? (
				<button type="button" className="btn" onClick={onRetry}>
					Retry
				</button>
			) : null}
		</div>
	)
}

export function EmptyState({
	title,
	hint,
	action,
}: {
	title: string
	hint?: ReactNode
	action?: ReactNode
}) {
	return (
		<div className="state-block">
			<p className="state-title">{title}</p>
			{hint ? <p className="state-message">{hint}</p> : null}
			{action}
		</div>
	)
}
