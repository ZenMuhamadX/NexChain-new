import { useState } from 'react'
import { usePlatform } from '../../src/hooks/usePlatform'

/**
 * Banner "versi baru tersedia".
 *
 * Dirender SHELL, bukan layar bersama: hanya PWA yang punya konsep update
 * service worker. `App` dan sembilan layar tetap platform-agnostik.
 *
 * Banner ini muncul karena `registerType: 'prompt'` — SW baru sengaja
 * menunggu. Tidak ada reload otomatis: memuat ulang halaman mengunci vault
 * dan membatalkan isian formulir, jadi keputusan itu milik user.
 */
export const PwaOverlay = (): React.JSX.Element | null => {
	const platform = usePlatform()
	const [dismissed, setDismissed] = useState(false)

	if (!platform.updateAvailable || dismissed) return null

	return (
		<div className="pwa-update" role="status" aria-live="polite">
			<div className="pwa-update__text">
				<strong>Versi baru tersedia</strong>
				<span>
					Muat ulang untuk memakai versi terbaru. Wallet perlu dibuka ulang
					setelahnya.
				</span>
			</div>
			<div className="pwa-update__actions">
				<button
					type="button"
					className="button button--ghost button--sm"
					onClick={() => setDismissed(true)}
				>
					Nanti
				</button>
				<button
					type="button"
					className="button button--primary button--sm"
					onClick={() => platform.applyUpdate()}
				>
					Muat ulang
				</button>
			</div>
		</div>
	)
}
