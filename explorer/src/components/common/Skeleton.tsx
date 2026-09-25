import type { ReactNode } from 'react'

/**
 * Skeleton loading — layout sudah ada sebelum data datang.
 *
 * Sebelumnya setiap navigasi route mengganti SELURUH halaman dengan satu
 * spinner tengah, lalu konten muncul → layout shift besar dan terasa lambat
 * walau RPC-nya cepat. Skeleton mempertahankan bentuk halaman tujuan.
 *
 * Semua elemen `aria-hidden` karena teks penjelasnya disampaikan lewat
 * region `role="status"` pada tiap skeleton utama.
 */

export function SkeletonBlock({ count = 6 }: { count?: number }) {
	return (
		<div className="stat-grid" aria-hidden="true">
			{Array.from({ length: count }, (_, index) => (
				<span key={index} className="skeleton skeleton-card" />
			))}
		</div>
	)
}

export function SkeletonTable({
	rows = 8,
	cols = 6,
}: {
	rows?: number
	cols?: number
}) {
	return (
		<div className="skeleton-table" aria-hidden="true">
			{Array.from({ length: rows }, (_, row) => (
				<div className="skeleton-row" key={row}>
					{Array.from({ length: cols }, (_, col) => (
						<span className="skeleton skeleton-text" key={col} />
					))}
				</div>
			))}
		</div>
	)
}

export function SkeletonLines({ count = 6 }: { count?: number }) {
	return (
		<div aria-hidden="true">
			{Array.from({ length: count }, (_, index) => (
				<span
					key={index}
					className="skeleton skeleton-text"
					style={{ width: `${55 + ((index * 13) % 40)}%` }}
				/>
			))}
		</div>
	)
}

/** Placeholder satu halaman: stat grid + kartu, dengan label untuk SR. */
export function PageSkeleton({
	label,
	lines = false,
}: {
	label: string
	lines?: boolean
}) {
	return (
		<div className="page" role="status" aria-live="polite">
			<span className="sr-only">{label}</span>
			<SkeletonBlock />
			<section className="panel">
				<span className="skeleton skeleton-title" aria-hidden="true" />
				<div className="mt-md">
					{lines ? <SkeletonLines /> : <SkeletonTable />}
				</div>
			</section>
		</div>
	)
}

/** Placeholder untuk blok konten tunggal di dalam page (bukan seluruh page). */
export function CardSkeleton({
	label,
	children,
}: {
	label: string
	children?: ReactNode
}) {
	return (
		<section className="card" role="status" aria-live="polite">
			<span className="sr-only">{label}</span>
			{children ?? <SkeletonLines />}
		</section>
	)
}
