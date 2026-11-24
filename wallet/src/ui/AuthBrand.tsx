import { BrandMark } from './BrandMark'
import { Icon } from './Icon'

/**
 * Identitas di kepala kartu auth: logo, nama, dan status "Wallet lokal".
 *
 * Sebelumnya ketiganya terpecah — brand di header luar layar, gembok besar di
 * dalam kartu, nama lagi sebagai eyebrow. Satu layar dengan tiga titik
 * identitas. Sekarang satu baris, di dalam kartu, di tempat mata mencarinya.
 *
 * "Wallet lokal" bukan hiasan: itu pernyataan kepercayaan (kunci tidak pernah
 * meninggalkan perangkat ini), jadi ia tetap terlihat, hanya subordinate.
 */
export const AuthBrand = (): React.JSX.Element => (
	<div className="auth-card__brand">
		<span className="auth-card__mark" aria-hidden="true">
			<BrandMark size={30} />
		</span>
		<span className="auth-card__brand-text">
			<strong>NexChain Wallet</strong>
			<small className="security-label">
				<Icon name="lock" size={12} aria-hidden="true" /> Wallet lokal
			</small>
		</span>
	</div>
)
