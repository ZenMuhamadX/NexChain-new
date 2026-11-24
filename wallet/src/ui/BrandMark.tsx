import markLight from '../../../brand/mark.svg'
import markInverse from '../../../brand/mark-inverse.svg'

/**
 * Mark jaringan NexChain — murni presentasi, tanpa logika.
 *
 * Digambar dari aset resmi `brand/` lewat import Vite, bukan salinan inline:
 * satu sumber kebenaran, dan kedua berkas < 4 KB sehingga ter-inline sebagai
 * `data:` URI (CSP wallet mengizinkan `img-src data:`), jadi target desktop
 * `file://` tidak pernah bergantung pada URL aset absolut.
 *
 * Dua varian diperlukan karena bracket `mark.svg` berwarna ink: di tema gelap
 * ia hilang, sehingga `mark-inverse.svg` yang dipakai. `installTheme()` selalu
 * menulis `data-theme`, jadi tidak ada keadaan "tanpa tema".
 */

/** Rasio lebar:tinggi mark (335:318) — width/height selalu proporsional. */
const RATIO = 335 / 318

interface BrandMarkProps {
	/** Tinggi mark dalam piksel; lebar mengikuti rasio. */
	size?: number
}

/**
 * Mark dua-tone: bracket ink/putih + kolom Nex Blue.
 *
 * Dekoratif dengan `alt=""` — pemanggil selalu menaruh nama "NexChain" di
 * sebelahnya atau membungkusnya dengan `aria-hidden`.
 */
export const BrandMark = ({ size = 30 }: BrandMarkProps): React.JSX.Element => {
	const width = Math.round(size * RATIO)

	return (
		<>
			<img
				className="brand-mark__light"
				src={markLight}
				width={width}
				height={size}
				alt=""
			/>
			<img
				className="brand-mark__inverse"
				src={markInverse}
				width={width}
				height={size}
				alt=""
			/>
		</>
	)
}
