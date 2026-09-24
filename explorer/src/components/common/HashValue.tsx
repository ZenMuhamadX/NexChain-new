import { useState } from 'react'
import { Link } from 'react-router-dom'
import { truncateMiddle } from '../../lib/format'
import { CopyButton } from './CopyButton'

/**
 * Tampilan hash/address: potong tengah, full value di title, opsi link
 * + tombol copy.
 *
 * Perbaikan aksesibilitas: `title` saja tidak muncul saat navigasi lewat
 * keyboard maupun di mobile, jadi nilai penuh kini juga dibawa `aria-label`
 * dan tersedia tombol "full" untuk menampilkannya inline tanpa harus
 * membuka halaman lain.
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
	const [expanded, setExpanded] = useState(false)

	if (!value) return <span className="muted">—</span>

	const limit = (head ?? 10) + (tail ?? 8) + 1
	const isTruncatable = value.length > limit
	const text = expanded ? value : truncateMiddle(value, head ?? 10, tail ?? 8)
	const classes = `${mono ? 'mono ' : ''}link-plain`

	const body = link ? (
		<Link className={classes} to={link} title={value} aria-label={value}>
			{text}
		</Link>
	) : (
		<span className={`${classes} no-link`} title={value} aria-label={value}>
			{text}
		</span>
	)

	return (
		<span className="hash-value">
			{body}
			{isTruncatable ? (
				<button
					type="button"
					className="copy-btn"
					aria-pressed={expanded}
					aria-label={expanded ? 'Show shortened value' : 'Show full value'}
					title={expanded ? 'Show shortened value' : 'Show full value'}
					onClick={() => setExpanded((value2) => !value2)}
				>
					{expanded ? 'less' : 'full'}
				</button>
			) : null}
			<CopyButton value={value} />
		</span>
	)
}
