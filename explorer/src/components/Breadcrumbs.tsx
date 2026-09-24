import { Fragment } from 'react'
import { Link } from 'react-router-dom'

export interface Crumb {
	label: string
	/** Bila tidak diisi, item terakhir ditandai `aria-current="page"`. */
	to?: string
}

/**
 * Breadcrumb — hierarki navigasi yang sebelumnya hilang sepenuhnya di
 * ketiga halaman detail (Block / Tx / Address).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
	return (
		<nav className="breadcrumbs" aria-label="Breadcrumb">
			<Link to="/">Home</Link>
			{items.map((crumb, index) => {
				const isLast = index === items.length - 1
				return (
					<Fragment key={`${crumb.label}-${index}`}>
						<span className="crumb-sep" aria-hidden="true">
							/
						</span>
						{crumb.to && !isLast ? (
							<Link to={crumb.to}>{crumb.label}</Link>
						) : (
							<span aria-current={isLast ? 'page' : undefined}>{crumb.label}</span>
						)}
					</Fragment>
				)
			})}
		</nav>
	)
}
