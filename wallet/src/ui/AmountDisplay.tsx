import { useState } from 'react'
import { NEXU_PER_NXC } from 'src/core/token/constants'
import {
	formatCount,
	formatNxcCompact,
	formatNxcExact,
	formatNxcWhole,
	nxcFractionDigits,
} from '../lib/format'
import { CopyButton } from './CopyButton'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface AmountDisplayProps {
	nexu: number
	className?: string
	size?: 'default' | 'large' | 'table' | 'inline'
	showUnit?: boolean
	showDetail?: boolean
	detailLabel?: string
	ariaLabel?: string
	/**
	 * Tampilkan bagian BULAT saja ("10.000"), dengan tombol presisi untuk
	 * sisanya. Dipakai angka utama di kartu saldo.
	 *
	 * Saldo di bawah 1 TIDAK ikut dipotong: menampilkan "0" untuk 0,00025
	 * berarti memberi tahu pengguna dananya habis. Kasus itu jatuh kembali ke
	 * tampilan ringkas.
	 */
	wholeOnly?: boolean
}

/** Compact amount with an optional exact-unit disclosure. */
export const AmountDisplay = ({
	nexu,
	className = '',
	size = 'default',
	showUnit = true,
	showDetail = true,
	detailLabel = 'Detail',
	ariaLabel = 'Lihat detail jumlah',
	wholeOnly = false,
}: AmountDisplayProps): React.JSX.Element => {
	const [open, setOpen] = useState(false)
	const compact = formatNxcCompact(nexu)
	const exact = formatNxcExact(nexu)
	const whole = formatNxcWhole(nexu)
	// "-0" dan "0" sama-sama berarti tidak ada bagian bulat yang layak tampil.
	const wholeIsZero = whole.replace('-', '') === '0'
	/** Digit pecahan pada nilai persis; nol di ekor sudah dibuang formatter. */
	const fracDigits = nxcFractionDigits(nexu)
	/**
	 * Apa yang tampil di kartu:
	 *
	 *   1. saldo < 1 → tampilkan pecahannya utuh. "0" untuk 0,00025 berarti
	 *      memberi tahu pengguna dananya habis;
	 *   2. pecahan ≤ 2 digit → tampilkan apa adanya, masih muat dan masih
	 *      terbaca sekilas;
	 *   3. pecahan lebih panjang → bagian bulat saja, sisanya lewat tombol.
	 */
	const shown = !wholeOnly
		? compact
		: wholeIsZero
			? compact
			: fracDigits <= 2
				? exact
				: whole
	/**
	 * Tombol presisi hanya muncul kalau ada yang DISEMBUNYIKAN — yaitu ketika
	 * angka yang tampil berbeda dari nilai persisnya.
	 *
	 * Gerbang ini sekaligus mencegah setiap baris daftar memasang satu dialog
	 * tersembunyi — dan dialog di dalam dialog memutus focus trap.
	 */
	const canDetail = showDetail && shown !== exact
	/**
	 * Kepadatan angka, dipakai CSS untuk mengecilkan huruf saat teksnya panjang.
	 *
	 * KENAPA perlu: di kartu, angka berbagi baris dengan dua ubin aksi. Pada
	 * layar 360 px ruangnya hanya ~179 px, sedangkan "50.000.000,34" butuh
	 * ~248 px pada ukuran penuh — angkanya menabrak tombol. CSS tidak bisa
	 * mengukur panjang teks, jadi panjangnya dititipkan sebagai atribut.
	 */
	const density = shown.length >= 12 ? 'tight' : shown.length >= 9 ? 'snug' : 'normal'

	return (
		<span
			className={`amount-display amount-display--${size} ${className}`.trim()}
			data-density={density}
		>
			<span className="amount-display__value">
				{shown}
				{showUnit ? <span className="amount-display__unit">NXC</span> : null}
			</span>
			{canDetail ? (
				<button
					type="button"
					className="amount-display__detail"
					onClick={() => setOpen(true)}
					aria-label={`${ariaLabel}: ${exact} NXC`}
					aria-haspopup="dialog"
				>
					<span>{detailLabel}</span>
					<Icon name="arrowUpRight" size={11} aria-hidden="true" />
				</button>
			) : null}
			{canDetail ? (
				<Modal
					open={open}
					onClose={() => setOpen(false)}
					title="Nilai presisi"
					size="sm"
					actions={
						<button type="button" className="button button--primary" onClick={() => setOpen(false)}>
							Tutup
						</button>
					}
				>
					{/*
					 * Nexu lebih dulu, NXC sebagai terjemahan.
					 *
					 * Nexu adalah bilangan BULAT di rantai — tidak ada pemisah
					 * desimal yang bisa salah dibaca. NXC di bawahnya hanya
					 * kenyamanan; kalau keduanya berbeda, nexu yang benar.
					 */}
					<div className="amount-detail">
						<span className="amount-detail__label">Nilai presisi (nexu)</span>
						<div className="amount-detail__row">
							<strong className="mono">{formatCount(nexu)} nexu</strong>
							<CopyButton
								text={String(nexu)}
								ariaLabel="Salin nilai presisi dalam nexu"
								variant="plain"
							/>
						</div>
						<span className="amount-detail__label">Setara</span>
						<strong className="mono">{exact} NXC</strong>
						<p>1 NXC = {NEXU_PER_NXC.toLocaleString('id-ID')} nexu</p>
					</div>
				</Modal>
			) : null}
		</span>
	)
}
