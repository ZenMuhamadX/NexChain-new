import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'

/**
 * Terima NXC sebagai sheet, bukan layar penuh.
 *
 * Isinya memang hanya satu hal (alamat + QR), jadi halaman penuh dengan
 * `page-heading` dan `receive-layout` dua kolom hanya menambah jarak tempuh
 * tanpa menambah informasi.
 *
 * `qrcode` diimpor dinamis: pustaka itu hanya dibutuhkan saat sheet ini
 * dibuka, dan sebagian pengguna tidak pernah membukanya.
 */
export const Receive = ({
	open,
	address,
	onClose,
}: {
	open: boolean
	address: string
	onClose: () => void
}): React.JSX.Element => {
	const [qrDataUrl, setQrDataUrl] = useState('')
	const canShare =
		typeof navigator !== 'undefined' && typeof navigator.share === 'function'

	useEffect(() => {
		if (!open) return
		let active = true
		void import('qrcode')
			.then((module) =>
				module.default.toDataURL(address, {
					width: 220,
					margin: 1,
					color: { dark: '#1f2937', light: '#ffffff' },
				}),
			)
			.then((url) => {
				if (active) setQrDataUrl(url)
			})
			.catch(() => {
				if (active) setQrDataUrl('')
			})
		return () => {
			active = false
		}
	}, [address, open])

	const share = async (): Promise<void> => {
		try {
			await navigator.share({ title: 'Alamat NexChain', text: address })
		} catch {
			// Pengguna membatalkan dialog bagikan — bukan kegagalan.
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="sheet"
			title="Terima NXC"
			actions={
				<div className="modal-actions">
					{canShare ? (
						<button
							type="button"
							className="button button--secondary"
							onClick={() => void share()}
						>
							<Icon name="arrowUpRight" size={15} aria-hidden="true" />
							Bagikan
						</button>
					) : (
						<CopyButton
							text={address}
							ariaLabel="Salin alamat penerimaan"
							variant="secondary"
						/>
					)}
					<button
						type="button"
						className="button button--primary"
						onClick={onClose}
					>
						Tutup
					</button>
				</div>
			}
		>
			<div className="sheet-form">
				<div className="qr-frame">
					{qrDataUrl ? (
						<img src={qrDataUrl} alt={`QR code alamat ${address}`} />
					) : (
						<div className="qr-loading">
							<span className="spinner spinner--sm" />
						</div>
					)}
				</div>
				<p className="qr-caption">
					Pindai hanya dengan wallet yang Anda percaya.
				</p>

				<div className="receive-address">
					<div className="receive-address__head">
						<span className="label">Alamat penerimaan</span>
						<CopyButton
							text={address}
							ariaLabel="Salin alamat penerimaan"
							variant="secondary"
						/>
					</div>
					<div className="address-panel address-panel--large">
						<code className="mono">{address}</code>
					</div>
				</div>

				<Notice variant="info">
					Pastikan pengirim memakai jaringan NexChain yang sama, dan cocokkan
					awal serta akhir alamat setelah memindai.
				</Notice>
			</div>
		</Modal>
	)
}
