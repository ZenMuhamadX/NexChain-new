import { useCallback, useEffect, useRef, useState } from 'react'
import { getVault } from './lib/vault'
import type { UnlockedWallet, WalletVault } from 'client/wallet/walletVault'
import {
	fetchAccount,
	fetchChainId,
	fetchNextNonce,
	fetchPending,
} from './lib/rpc'
import type { Screen, Tab } from './types'
import { Icon } from './ui/Icon'
import type { IconName } from './ui/Icon'
import { Notice } from './ui/Notice'
import { Welcome } from './screens/Welcome'
import { SetupWallet } from './screens/SetupWallet'
import { Unlock } from './screens/Unlock'
import { Dashboard } from './screens/Dashboard'
import { Send } from './screens/Send'
import { Receive } from './screens/Receive'
import { History } from './screens/History'
import { Settings } from './screens/Settings'
import { errorMessage } from './lib/format'
import { useIsPopup } from './lib/surface'
import { traceNote, traceStep, traceWarn, describePendingStep } from './lib/trace'

const TAB_ICONS: Record<Tab, IconName> = {
	ringkasan: 'home',
	kirim: 'arrowUpRight',
	terima: 'arrowDownLeft',
	riwayat: 'clock',
	pengaturan: 'sliders',
}

const TAB_LABELS: Record<Tab, string> = {
	ringkasan: 'Beranda',
	kirim: 'Kirim',
	terima: 'Terima',
	riwayat: 'Riwayat',
	pengaturan: 'Setelan',
}

/** Interval polling saldo: 15 detik terlalu agresif untuk popup berumur pendek. */
const REFRESH_INTERVAL_MS = 20_000

/** Penghitung mount — untuk membedakan pass StrictMode di log. */
let mountCounter = 0

export const App = (): React.JSX.Element => {
	const [vault, setVault] = useState<WalletVault | undefined>()
	const [wallet, setWallet] = useState<UnlockedWallet | undefined>()
	const [screen, setScreen] = useState<Screen>('welcome')
	const [booting, setBooting] = useState(true)
	const [bootError, setBootError] = useState('')
	const [tab, setTab] = useState<Tab>('ringkasan')

	const [balance, setBalance] = useState(0)
	const [pending, setPending] = useState(0)
	const [nonce, setNonce] = useState(0)
	const [chainId, setChainId] = useState<number | undefined>()
	const [loading, setLoading] = useState(false)
	const [netError, setNetError] = useState('')
	const [hasWallet, setHasWallet] = useState(false)

	/**
	 * Guard anti-race untuk polling: refresh dapat dipicu oleh interval,
	 * tombol Segarkan, dan `onSent` hampir bersamaan. Tanpa penjaga ini,
	 * respons pertama yang selesai bisa menimpa data yang lebih baru.
	 */
	const inFlight = useRef(false)

	const isPopup = useIsPopup()

	const refresh = useCallback(async (address: string): Promise<void> => {
		if (inFlight.current) return
		inFlight.current = true
		setLoading(true)
		setNetError('')
		try {
			const [account, pendingInfo, nextNonce, id] = await Promise.all([
				fetchAccount(address),
				fetchPending(address),
				fetchNextNonce(address),
				fetchChainId(),
			])
			setBalance(account?.balance ?? 0)
			setPending(pendingInfo?.pendingAmount ?? 0)
			setNonce(nextNonce)
			if (typeof id === 'number') setChainId(id)
		} catch (error) {
			setNetError(errorMessage(error))
		} finally {
			inFlight.current = false
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		let alive = true
		// ID unik per-mount supaya bisa membedakan pass StrictMode.
		const mountId = ++mountCounter
		traceNote(`App: mulai penyiapan vault (mount #${mountId})`)

		/**
		 * Jaring pengaman: bila penyiapan vault menggantung, splash tidak
		 * boleh berputar selamanya tanpa penjelasan.
		 *
		 * PENTING — kenapa `settled` dipakai, bukan hanya `booting`:
		 * kondisi sebelumnya `if (alive && booting)` membuat failsafe
		 * bergantung pada closure `booting` DARI RENDER PERTAMA. Di React
		 * `StrictMode`, pass mount-1 unmount lalu mount-2 memasang failsafe
		 * BARU; failsafe pass-1 tidak pernah dibatalkan bila cleanup tidak
		 * sempat jalan, sehingga ia menyala di detik ke-15 dan memunculkan
		 * galat padahal boot SUDAH selesai.
		 *
		 * `settled` adalah penanda milik EFEK INI SENDIRI — bukan state React
		 * — sehingga tidak bisa "basi" karena render ulang. Boot selesai →
		 * `settled = true` → failsafe apa pun milik efek ini tidak menyala.
		 */
		let settled = false

		const failsafe = window.setTimeout(() => {
			traceNote(
				`App: FAILSAFE cek (mount #${mountId}) alive=${alive} settled=${settled}`,
			)
			// `settled` = boot sudah selesai → JANGAN tampilkan galat.
			if (settled) {
				traceNote(`App: FAILSAFE mount #${mountId} dilewati (boot selesai)`)
				return
			}
			if (!alive) return
			traceWarn(
				`App: FAILSAFE 15 dtk menyala (mount #${mountId}) — ${describePendingStep()}`,
			)
			// Tulis ringkasan ke DOM supaya terlihat walau console tertutup.
			try {
				const marker = document.createElement('pre')
				marker.id = 'boot-stuck'
				marker.style.cssText =
					'position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
					'margin:0;padding:6px 8px;font:10px/1.4 ui-monospace,monospace;' +
					'background:#7f1d1d;color:#fff;white-space:pre-wrap'
				marker.textContent = `[gagal] mount #${mountId}. ${describePendingStep()}`
				document.body.appendChild(marker)
			} catch {
				/* DOM bisa tidak tersedia; abaikan. */
			}
			setBootError(
				'Penyimpanan tidak merespons. Coba tutup dan buka ulang popup.',
			)
			setBooting(false)
		}, 15_000)

		void (async () => {
			try {
				const instance = await traceStep('App: getVault()', () => getVault())
				traceNote(`App: vault siap (mount #${mountId})`)
				if (!alive) {
					traceWarn(
						`App: mount #${mountId} sudah di-unmount — berhenti`,
					)
					return
				}
				setVault(instance)
				const exists = await traceStep('App: hasWallet()', () =>
					instance.hasWallet(),
				)
				traceNote(`App: hasWallet = ${exists} (mount #${mountId})`)
				if (!alive) {
					traceWarn(`App: mount #${mountId} di-unmount setelah hasWallet`)
					return
				}
				setHasWallet(exists)
				if (instance.isUnlocked()) setWallet(instance.getUnlocked())
				else if (exists) setScreen('unlock')
			} catch (error) {
				traceWarn(`App: boot gagal (mount #${mountId})`, errorMessage(error))
				if (alive) setBootError(errorMessage(error))
			} finally {
				// Tandai SELESAI apa pun hasilnya — ini yang mematikan failsafe
				// milik efek ini, tanpa bergantung pada state React.
				settled = true
				traceNote(
					`App: finally (mount #${mountId}) settled=true, alive=${alive}`,
				)
				if (alive) {
					setBooting(false)
					traceNote(`App: setBooting(false) dipanggil (mount #${mountId})`)
				}
			}
		})()

		return () => {
			// Cleanup: batalkan failsafe agar efek yang di-unmount StrictMode
			// tidak pernah menyala dan menampilkan galat palsu.
			settled = true
			traceWarn(
				`App: CLEANUP mount #${mountId} — failsafe dibatalkan`,
			)
			alive = false
			window.clearTimeout(failsafe)
		}
	}, [])

	useEffect(() => {
		if (!wallet) return
		void refresh(wallet.address)
		const timer = window.setInterval(
			() => void refresh(wallet.address),
			REFRESH_INTERVAL_MS,
		)
		return () => window.clearInterval(timer)
	}, [wallet, refresh])

	const enterWallet = (instance: WalletVault): void => {
		setWallet(instance.getUnlocked())
		setHasWallet(true)
		setTab('ringkasan')
	}

	const handleSetup = async (
		mnemonic: string,
		passphrase: string,
	): Promise<void> => {
		if (!vault) throw new Error('Vault belum siap.')
		await vault.importMnemonic(mnemonic, passphrase)
		enterWallet(vault)
	}

	const handleUnlock = async (passphrase: string): Promise<void> => {
		if (!vault) throw new Error('Vault belum siap.')
		await vault.unlock(passphrase)
		enterWallet(vault)
	}

	const handleLock = (): void => {
		vault?.lock()
		setWallet(undefined)
		setBalance(0)
		setPending(0)
		setNonce(0)
		setNetError('')
		setScreen('unlock')
	}

	const handleWipe = async (): Promise<void> => {
		if (!vault) return
		await vault.wipe()
		setWallet(undefined)
		setHasWallet(false)
		setBalance(0)
		setPending(0)
		setNonce(0)
		setTab('ringkasan')
		setScreen('welcome')
	}

	if (booting) {
		return (
			<div className="auth-shell auth-shell--center">
				<div className="boot-splash">
					<span className="boot-splash__mark" aria-hidden="true">
						<Icon name="diamond" size={26} />
					</span>
					<div className="loading-state">
						<span className="spinner" aria-hidden="true" />
						<p>Menyiapkan vault lokal…</p>
					</div>
				</div>
			</div>
		)
	}

	if (bootError) {
		return (
			<div className="auth-shell auth-shell--center">
				<div className="notice-stack">
					<Notice variant="error">{`Gagal menyiapkan penyimpanan: ${bootError}`}</Notice>
				</div>
			</div>
		)
	}

	if (!wallet) {
		return (
			<div className={`auth-shell ${isPopup ? 'auth-shell--popup' : ''}`}>
				<header className="auth-header">
					<div className="brand">
						<span className="brand-mark" aria-hidden="true">
							<Icon name="diamond" size={15} />
						</span>
						<span>NexChain Wallet</span>
					</div>
					<span className="security-label">
						<Icon name="lock" size={13} aria-hidden="true" /> Vault lokal
					</span>
				</header>
				<main className="auth-main">
					{screen === 'unlock' && vault ? (
						<Unlock onUnlock={handleUnlock} go={setScreen} />
					) : hasWallet ? (
						<Unlock onUnlock={handleUnlock} go={setScreen} />
					) : screen === 'create' || screen === 'import' ? (
						<SetupWallet mode={screen} onDone={handleSetup} go={setScreen} />
					) : (
						<Welcome go={setScreen} />
					)}
				</main>
			</div>
		)
	}

	const networkState = netError ? 'offline' : loading ? 'connecting' : 'connected'
	const networkLabel = netError
		? 'Node offline'
		: loading && chainId === undefined
			? 'Menghubungkan…'
			: chainId !== undefined
				? `Chain ${chainId}`
				: 'Terhubung'

	return (
		<div className={`app-shell ${isPopup ? 'app-shell--popup' : ''}`}>
			<header className="app-header">
				<div className="app-header__inner">
					<div className="brand">
						<span className="brand-mark" aria-hidden="true">
							<Icon name="diamond" size={15} />
						</span>
						<span className="brand__text">
							<strong>NexChain</strong>
							<small>Wallet</small>
						</span>
					</div>
					<div className="header-actions">
						<span
							className={`network-pill network-pill--${networkState}`}
							role="status"
							aria-live="polite"
							title={networkLabel}
						>
							<span className="network-dot" aria-hidden="true" />
							<span className="network-label">{networkLabel}</span>
						</span>
						<button
							type="button"
							className="icon-button"
							onClick={handleLock}
							title="Kunci wallet"
							aria-label="Kunci wallet"
						>
							<Icon name="lock" size={16} aria-hidden="true" />
						</button>
					</div>
				</div>
			</header>

			<main className="app-main" id="main-content">
				{netError ? (
					<Notice
						variant="error"
						action={{ label: 'Coba lagi', onClick: () => void refresh(wallet.address) }}
					>
						RPC belum dapat dihubungi. Periksa URL node di Setelan.
					</Notice>
				) : null}

				{tab === 'ringkasan' ? (
					<Dashboard
						address={wallet.address}
						balance={balance}
						pending={pending}
						nonce={nonce}
						chainId={chainId}
						loading={loading}
						networkLabel={networkLabel}
						refresh={() => void refresh(wallet.address)}
						setTab={setTab}
					/>
				) : null}
				{tab === 'kirim' ? (
					<Send
						sender={wallet.address}
						privateKey={wallet.privateKey}
						balance={balance}
						pending={pending}
						setTab={setTab}
						onSent={() => void refresh(wallet.address)}
					/>
				) : null}
				{tab === 'terima' ? <Receive address={wallet.address} /> : null}
				{tab === 'riwayat' ? (
					<History address={wallet.address} setTab={setTab} />
				) : null}
				{tab === 'pengaturan' ? (
					<Settings
						address={wallet.address}
						mnemonic={wallet.mnemonic}
						chainId={chainId}
						isPopup={isPopup}
						onLock={handleLock}
						onWipe={handleWipe}
					/>
				) : null}
			</main>

			<nav className="tab-bar" aria-label="Navigasi wallet">
				{(Object.keys(TAB_LABELS) as Tab[]).map((value) => (
					<button
						key={value}
						type="button"
						className={`tab-bar__item ${tab === value ? 'tab-bar__item--active' : ''}`}
						onClick={() => setTab(value)}
						aria-current={tab === value ? 'page' : undefined}
					>
						<Icon name={TAB_ICONS[value]} size={19} aria-hidden="true" />
						<span>{TAB_LABELS[value]}</span>
					</button>
				))}
			</nav>
		</div>
	)
}
