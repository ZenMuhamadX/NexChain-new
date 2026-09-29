import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Notice } from '../ui/Notice'

/**
 * Layar Terima.
 *
 * KEPUTUSAN UKURAN: QR 196px (bukan 244px seperti wallet-ui). Di popup 360px,
 * 196px + padding masih menyisakan ruang untuk alamat dan tombol salin tanpa
 * memaksa pengguna menggulir. Modul QR tetap ~4px di ukuran ini — masih jauh
 * di atas minimum yang dapat dipindai kamera ponsel.
 */
export const Receive = ({ address }: { address: string }): React.JSX.Element => {
	const [qrDataUrl, setQrDataUrl] = useState('')

	useEffect(() => {
		let active = true
		void QRCode.toDataURL(address, {
			width: 480,
			margin: 1,
			errorCorrectionLevel: 'M',
			color: { dark: '#0f1826', light: '#ffffff' },
		})
			.then((url) => {
				if (active) setQrDataUrl(url)
			})
			.catch(() => {
				if (active) setQrDataUrl('')
			})
		return () => {
			active = false
		}
	}, [address])

	return (
		<div className="page-stack">
			<div className="page-head">
				<div>
					<h1>Terima NXC</h1>
					<p className="page-head__sub">Bagikan alamat atau tunjukkan QR ini.</p>
				</div>
			</div>

			<section className="card receive-card">
				<div className="qr-frame">
					{qrDataUrl ? (
						<img src={qrDataUrl} alt={`QR code untuk ${address}`} />
					) : (
						<div className="qr-loading">
							<span className="spinner spinner--sm" aria-hidden="true" />
						</div>
					)}
				</div>
				<p className="qr-caption">Pindai hanya dengan wallet yang Anda percaya.</p>
			</section>

			<section className="card receive-details">
				<div className="card-title">
					<span className="eyebrow">Alamat Anda</span>
					<CopyButton
						text={address}
						ariaLabel="Salin alamat penerimaan"
						variant="primary"
						size={14}
					>
						Salin alamat
					</CopyButton>
				</div>
				{/* Alamat selalu ditampilkan UTUH di sini — pengirim perlu
				    memverifikasi karakter awal dan akhir sebelum mentransfer. */}
				<div className="address-panel address-panel--stack">
					<code>{address}</code>
				</div>
			</section>

			<section className="info-strip">
				<div className="info-strip__icon" aria-hidden="true">
					<Icon name="alert" size={15} />
				</div>
				<div>
					<strong>Verifikasi sebelum mengirim</strong>
					<span>
						Pastikan pengirim memakai jaringan NexChain yang sama dan
						membandingkan 4 karakter awal serta akhir alamat.
					</span>
				</div>
			</section>

			<Notice variant="info">
				Transfer antar-jaringan akan membuat dana tidak dapat dipulihkan.
			</Notice>
		</div>
	)
}
