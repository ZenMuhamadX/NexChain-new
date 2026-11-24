import { Icon } from './Icon'

/** Tab yang punya layar sendiri. "Kirim" sengaja BUKAN tab — ia sheet. */
export type MainTab = 'beranda' | 'riwayat' | 'setelan'

interface TabBarProps {
	active: MainTab
	onSelect: (tab: MainTab) => void
	/** Membuka sheet Kirim. */
	onSend: () => void
}

/**
 * Navigasi utama — SATU elemen untuk dua tata letak.
 *
 * Di layar sempit ia menempel di bawah; di desktop ia duduk di baris header
 * sebagai empat tab sejajar. Satu elemen, satu landmark, satu urutan keyboard.
 * Sebelumnya header punya tombol Riwayat/Pengaturan sendiri (`aria-pressed`)
 * sementara bar bawah memakai `aria-current` — dua sistem navigasi dengan
 * perilaku berbeda yang tidak pernah tampil bersamaan.
 *
 * Empat item dibuat SAMA BESAR. Dulu "Kirim" adalah tombol mengambang 52 px di
 * tengah: pola yang terbaca seperti tombol nyasar begitu bar-nya bukan lima
 * kolom, dan tidak masuk akal sama sekali di header desktop.
 *
 * "Kirim" tetap tombol biasa, bukan tab: ia tidak punya layar, ia membuka
 * sheet. Karena itu tanpa `aria-current`, yang akan menjanjikan panel yang
 * tidak ada.
 */
export const TabBar = ({
	active,
	onSelect,
	onSend,
}: TabBarProps): React.JSX.Element => {
	const item = (
		tab: MainTab,
		icon: 'home' | 'clock' | 'sliders',
		label: string,
	): React.JSX.Element => (
		<button
			type="button"
			className={
				active === tab ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'
			}
			onClick={() => onSelect(tab)}
			aria-current={active === tab ? 'page' : undefined}
		>
			<span className="tab-bar__icon">
				<Icon name={icon} size={20} aria-hidden="true" />
			</span>
			<span>{label}</span>
		</button>
	)

	return (
		<nav className="tab-bar" aria-label="Navigasi utama">
			{item('beranda', 'home', 'Beranda')}
			{item('riwayat', 'clock', 'Riwayat')}
			<button
				type="button"
				className="tab-bar__item"
				onClick={onSend}
				aria-label="Kirim NXC"
			>
				<span className="tab-bar__icon">
					<Icon name="arrowUpRight" size={20} aria-hidden="true" />
				</span>
				<span>Kirim</span>
			</button>
			{item('setelan', 'sliders', 'Setelan')}
		</nav>
	)
}
