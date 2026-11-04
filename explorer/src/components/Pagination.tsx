import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type PaginationProps = {
	/** Halaman aktif, 1-based. */
	page: number
	totalPages: number
	/** URL halaman ke-n. Memakai <Link> supaya bisa dibuka di tab baru,
	 *  di-bookmark, dan tombol back browser tetap bekerja. */
	hrefFor: (page: number) => string
	label?: string
}

const GAP = 'gap' as const

/**
 * Deret halaman yang ditampilkan: halaman pertama, terakhir, dan tetangga
 * langsung dari halaman aktif. Jarak yang dilewati diringkas jadi elipsis.
 *
 * Contoh (aktif 6 dari 53): 1 … 5 6 7 … 53
 */
function pageItems(page: number, total: number): Array<number | typeof GAP> {
	const keep = new Set<number>([1, total])
	for (let p = page - 1; p <= page + 1; p += 1) {
		if (p >= 1 && p <= total) keep.add(p)
	}

	const sorted = [...keep].sort((a, b) => a - b)
	const out: Array<number | typeof GAP> = []
	let previous = 0
	for (const value of sorted) {
		if (previous > 0 && value - previous > 1) out.push(GAP)
		out.push(value)
		previous = value
	}
	return out
}

/**
 * Tombol Prev / Next. Saat tidak berlaku, elemen diganti <span> — bukan
 * <a aria-disabled> — supaya tidak ada tautan yang masih bisa diaktifkan
 * lewat keyboard.
 */
function Edge({
	to,
	disabled,
	label,
	children,
}: {
	to: string
	disabled: boolean
	label: string
	children: ReactNode
}) {
	const base = 'pager-btn'
	if (disabled) {
		return (
			<span className={`${base} is-disabled`} aria-disabled="true">
				{children}
			</span>
		)
	}
	return (
		<Link className={base} to={to} aria-label={label}>
			{children}
		</Link>
	)
}

export function Pagination({
	page,
	totalPages,
	hrefFor,
	label = 'Pagination',
}: PaginationProps) {
	if (totalPages <= 1) return null

	const atStart = page <= 1
	const atEnd = page >= totalPages

	return (
		<nav className="pager" aria-label={label}>
			<Edge to={hrefFor(page - 1)} disabled={atStart} label="Previous page">
				← Prev
			</Edge>

			{pageItems(page, totalPages).map((item, index) => {
				if (item === GAP) {
					return (
						<span
							className="pager-gap"
							key={`gap-${index}`}
							aria-hidden="true"
						>
							…
						</span>
					)
				}
				const name = `Page ${item}`
				return item === page ? (
					<span
						className="pager-num is-current"
						key={item}
						aria-current="page"
						aria-label={`${name}, current page`}
					>
						{item}
					</span>
				) : (
					<Link className="pager-num" key={item} to={hrefFor(item)} aria-label={name}>
						{item}
					</Link>
				)
			})}

			<Edge to={hrefFor(page + 1)} disabled={atEnd} label="Next page">
				Next →
			</Edge>
		</nav>
	)
}
