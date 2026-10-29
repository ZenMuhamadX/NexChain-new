import { useId } from 'react'

/**
 * Mark brand NexChain — murni presentasi, tanpa logika.
 *
 * Kedua komponen digambar inline, BUKAN lewat berkas `.svg` yang diimpor:
 * `vite-env.d.ts` belum punya deklarasi modul `*.svg`, dan target desktop
 * memakai `base: './'` sehingga URL aset absolut gagal di bawah `file://`.
 *
 * Geometrinya disalin apa adanya dari kanvas 64×64 di `brand/` supaya header
 * wallet, favicon, dan ikon aplikasi desktop tidak pernah bisa berbeda.
 */

/** Kanvas kanonik — semua koordinat di bawah memakai ruang 64×64. */
const VIEWBOX = '0 0 64 64'

/** Gradient brand: Nex Blue 400 → Nex Teal 500 pada sumbu 135°. */
const GRADIENT_FROM = '#2b9fd8'
const GRADIENT_TO = '#0f766e'

interface BrandMarkProps {
	/** Sisi kotak dalam piksel. Badge mengisi penuh wadahnya. */
	size?: number
	className?: string
	/** Bila diisi, mark diberi nama untuk pembaca layar. Kosong = dekoratif. */
	title?: string
}

/**
 * Mark jaringan: badge rounded-square bergradient dengan huruf N.
 *
 * Badge ini identik dengan favicon dan ikon aplikasi desktop — jadi tab
 * browser, header wallet, dan taskbar selalu menampilkan hal yang sama.
 * Wadah pemanggil (`.brand-mark`, `.auth-card__mark`, `.settings-icon`,
 * `.info-strip__icon`) punya radius yang secara proporsional lebih besar,
 * sehingga badge selalu menutupinya rapi tanpa sisa warna di sudut.
 */
export const BrandMark = ({
	size = 30,
	className,
	title,
}: BrandMarkProps): React.JSX.Element => {
	// Beberapa instance hidup di satu halaman sekaligus; id gradient harus unik
	// supaya tidak ada dua <linearGradient> yang saling menimpa.
	const gradientId = `nx-mark-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`

	return (
		<svg
			width={size}
			height={size}
			viewBox={VIEWBOX}
			className={className}
			role={title ? 'img' : undefined}
			aria-hidden={title ? undefined : true}
			aria-label={title}
			focusable="false"
		>
			<defs>
				<linearGradient
					id={gradientId}
					x1="8"
					y1="6"
					x2="58"
					y2="58"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset="0" stopColor={GRADIENT_FROM} />
					<stop offset="1" stopColor={GRADIENT_TO} />
				</linearGradient>
			</defs>
			<rect width="64" height="64" rx="15" fill={`url(#${gradientId})`} />
			<path
				d="M21 20v24M21 20l22 24M43 20v24"
				fill="none"
				stroke="#ffffff"
				strokeWidth={5}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<g fill="#ffffff">
				<circle cx="21" cy="20" r="3.6" />
				<circle cx="21" cy="44" r="3.6" />
				<circle cx="43" cy="20" r="3.6" />
				<circle cx="43" cy="44" r="3.6" />
				<circle cx="32" cy="32" r="4.8" />
			</g>
		</svg>
	)
}

interface NxcCoinProps {
	size?: number
	className?: string
	/** Bila diisi, ikon diberi nama untuk pembaca layar. Kosong = dekoratif. */
	title?: string
}

/**
 * Ikon token NXC: cincin koin dengan huruf N yang terbelah oleh cincin node.
 *
 * Digambar monokrom lewat `currentColor` supaya bisa duduk di dalam chip
 * berwarna (`.card-icon--blue`) maupun mengikuti warna teks di dalam
 * `AmountDisplay`. Ukuran boleh ditimpa dari CSS (lihat `.amount-display__coin`)
 * karena aturan CSS mengalahkan atribut `width`/`height` pada elemen SVG.
 */
export const NxcCoin = ({
	size = 18,
	className,
	title,
}: NxcCoinProps): React.JSX.Element => (
	<svg
		width={size}
		height={size}
		viewBox={VIEWBOX}
		className={className}
		fill="none"
		stroke="currentColor"
		role={title ? 'img' : undefined}
		aria-hidden={title ? undefined : true}
		aria-label={title}
		focusable="false"
	>
		<circle cx="32" cy="32" r="27" strokeWidth={4.5} />
		<g strokeWidth={6.5} strokeLinejoin="miter" strokeMiterlimit={2} strokeLinecap="butt">
			<path d="M22 42V22l6.46 6.46" />
			<path d="M42 22v20l-6.46-6.46" />
		</g>
		<circle cx="32" cy="32" r="5.2" strokeWidth={2.6} />
	</svg>
)
