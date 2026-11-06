import { Icon } from './Icon'

/** Tab yang punya layar sendiri. "Terima" sengaja BUKAN tab — ia sheet. */
export type MainTab = 'beranda' | 'riwayat' | 'setelan'

interface TabBarProps {
	active: MainTab
	onSelect: (tab: MainTab) => void
	/** Tombol tengah membuka sheet Terima (kode QR). */
	onReceive: () => void
}

/**
 * Tab bar bawah — HANYA untuk layar sempit.
 *
 * Di desktop (`> 700px`) elemen ini disembunyikan CSS dan navigasi kembali ke
 * header seperti sebelumnya: tab bar yang dilebarkan selebar 720px terbaca
 * sebagai aplikasi ponsel yang dipasang di jendela, bukan sebagai navigasi.
 *
 * Tombol tengah bukan tab: ia tidak punya layar, ia membuka sheet. Karena itu
 * ditandai `<button>` biasa tanpa `aria-current`, bukan `role="tab"` yang akan
 * menjanjikan panel yang tidak ada.
 */
export const TabBar = ({
	active,
	onSelect,
	onReceive,
}: TabBarProps): React.JSX.Element => {
	const item = (
		tab: MainTab,
		icon: 'home' | 'clock' | 'sliders',
		label: string,
	): React.JSX.Element => (
		<button
			type="button"
			className={`tab-bar__item ${active === tab ? 'tab-bar__item--active' : ''}`}
			onClick={() => onSelect(tab)}
			aria-current={active === tab ? 'page' : undefined}
		>
			<Icon name={icon} size={20} aria-hidden="true" />
			<span>{label}</span>
		</button>
	)

	return (
		<nav className="tab-bar" aria-label="Navigasi utama">
			{item('beranda', 'home', 'Beranda')}
			{item('riwayat', 'clock', 'Riwayat')}
			<button
				type="button"
				className="tab-bar__fab"
				onClick={onReceive}
				aria-label="Terima NXC — buka kode QR"
			>
				<span className="tab-bar__fab-icon" aria-hidden="true">
					<Icon name="qr" size={22} />
				</span>
				<span>Terima</span>
			</button>
			{item('setelan', 'sliders', 'Setelan')}
		</nav>
	)
}
