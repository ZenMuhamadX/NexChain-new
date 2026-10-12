import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Notice } from '../ui/Notice'

export const Receive = ({ address }: { address: string }): React.JSX.Element => {
	const [qrDataUrl, setQrDataUrl] = useState('')

	useEffect(() => {
		let active = true
		void QRCode.toDataURL(address, {
			width: 220,
			margin: 1,
			color: { dark: '#1f2937', light: '#ffffff' },
		}).then((url) => {
			if (active) setQrDataUrl(url)
		}).catch(() => {
			if (active) setQrDataUrl('')
		})
		return () => {
			active = false
		}
	}, [address])

	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<p className="eyebrow">TERIMA NXC</p>
					<h1>Terima dana</h1>
					<p>Bagikan alamat Anda atau minta pihak lain memindai QR code.</p>
				</div>
			</div>

			<div className="receive-layout">
				<section className="card receive-card">
					<div className="qr-frame">
						{qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${address}`} /> : <div className="qr-loading"><span className="spinner spinner--sm" /></div>}
					</div>
					<p className="qr-caption">Pindai hanya dengan wallet yang Anda percaya.</p>
				</section>

				<section className="card receive-details">
					<div className="card-header">
						<div>
							<p className="eyebrow">ALAMAT ANDA</p>
							<h2>Alamat penerimaan</h2>
						</div>
						<CopyButton text={address} ariaLabel="Salin alamat penerimaan" variant="secondary" />
					</div>
					<div className="address-panel address-panel--large">
						<code className="mono">{address}</code>
					</div>
					<Notice variant="info">
						Pastikan pengirim menggunakan jaringan NexChain yang sama sebelum mengirim dana.
					</Notice>
				</section>
			</div>

			<section className="info-strip">
				<div className="info-strip__icon"><Icon name="diamond" size={16} aria-hidden="true" /></div>
				<div>
					<strong>Verifikasi sebelum mengirim</strong>
					<span>Bandingkan karakter awal dan akhir alamat setelah memindai.</span>
				</div>
			</section>
		</div>
	)
}
