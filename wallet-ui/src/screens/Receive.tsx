import { useState } from 'react'
import { copyText } from '../lib/format'
import { Icon } from '../ui/Icon'
import type { Tab } from '../types'

/** Tab Terima: tampilkan alamat penuh + QR sederhana (via API eksternal opsional). */
export const Receive = ({
	address,
	setTab,
}: {
	address: string
	setTab: (t: Tab) => void
}): React.JSX.Element => {
	const [copied, setCopied] = useState(false)

	const copy = async (): Promise<void> => {
		const ok = await copyText(address)
		setCopied(ok)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<section className="card center">
			<h2>Terima NXC</h2>
			<p className="muted small">Bagikan alamat ini untuk menerima dana.</p>
			<div className="address mono receive-address">{address}</div>
			<div className="row center">
				<button className="primary" onClick={() => void copy()}>
					<Icon name={copied ? 'check' : 'copy'} size={15} />
					{copied ? 'Tersalin' : 'Salin'}
				</button>
				<button className="ghost" onClick={() => setTab('ringkasan')}>
					Kembali
				</button>
			</div>
			<p className="hint">
				Pastikan jaringan selaras sebelum meminta pengiriman.
			</p>
		</section>
	)
}
