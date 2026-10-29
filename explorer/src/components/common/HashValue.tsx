import { Link } from 'react-router-dom'
import { truncateMiddle } from '../../lib/format'

/**
 * Tampilan hash/address: potong tengah, nilai penuh di `title` dan
 * `aria-label`, opsional jadi tautan.
 *
 * Tombol "full" dan "copy" sudah dibuang dari sini. Di kartu ringkas
 * (Chain Head) keduanya mendorong nilai turun ke baris kedua dan merusak
 * tinggi baris yang harus seragam; nilai penuh tetap bisa dibaca lewat
 * tooltip maupun halaman detail yang ditautkan. Tombol copy mandiri masih
 * tersedia di halaman detail (AddressPage/RawJson).
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

	return (
		<span className="hash-value">
			{link ? (
				<Link className={classes} to={link} title={value} aria-label={value}>
					{text}
				</Link>
			) : (
				<span className={`${classes} no-link`} title={value} aria-label={value}>
					{text}
				</span>
			)}
		</span>
	)
}
