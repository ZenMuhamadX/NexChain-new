import { Link } from 'react-router-dom'
import { truncateMiddle } from '../../lib/format'
import { CopyButton } from './CopyButton'

/**
 * Tampilan hash/address: potong tengah, full value di title,
 * opsi link + tombol copy.
 */
export function HashValue({
	value,
	link,
	head,
	tail,
	mono = true,
}: {
	value: string | undefined | null
	link?: string
	head?: number
	tail?: number
	mono?: boolean
}) {
	if (!value) return <span className="muted">—</span>

	const text = truncateMiddle(value, head ?? 10, tail ?? 8)
	const classes = `${mono ? 'mono ' : ''}link-plain`

	const body = link ? (
		<Link className={classes} to={link} title={value}>
			{text}
		</Link>
	) : (
		<span className={`${classes} no-link`} title={value}>
			{text}
		</span>
	)

	return (
		<span className="hash-value">
			{body}
			<CopyButton value={value} />
		</span>
	)
}
