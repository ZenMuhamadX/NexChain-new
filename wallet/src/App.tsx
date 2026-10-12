import { useCallback, useEffect, useState } from 'react'
import { getVault } from './lib/vault'
import type { UnlockedWallet, WalletVault } from 'src/client/wallet/walletVault'
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

const TAB_ICONS: Record<Tab, IconName> = {
	ringkasan: 'home',
	kirim: 'arrowUpRight',
	terima: 'arrowDownLeft',
	riwayat: 'clock',
	pengaturan: 'sliders',
}

const TAB_LABELS: Record<Tab, string> = {
	ringkasan: 'Ringkasan',
	kirim: 'Kirim',
	terima: 'Terima',
	riwayat: 'Riwayat',
	pengaturan: 'Pengaturan',
}

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

	const refresh = useCallback(async (address: string): Promise<void> => {
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
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		let alive = true
		void (async () => {
			try {
				const instance = await getVault()
				if (!alive) return
				setVault(instance)
				if (instance.isUnlocked()) setWallet(instance.getUnlocked())
				else if (await instance.hasWallet()) setScreen('unlock')
			} catch (error) {
				if (alive) setBootError(errorMessage(error))
			} finally {
				if (alive) setBooting(false)
			}
		})()
		return () => {
			alive = false
		}
	}, [])

	useEffect(() => {
		if (!wallet) return
		void refresh(wallet.address)
		const timer = window.setInterval(() => void refresh(wallet.address), 15_000)
		return () => window.clearInterval(timer)
	}, [wallet, refresh])

	const enterWallet = (instance: WalletVault): void => {
		setWallet(instance.getUnlocked())
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
		setScreen('unlock')
	}

	const handleWipe = async (): Promise<void> => {
		if (!vault) return
		await vault.wipe()
		setWallet(undefined)
		setBalance(0)
		setPending(0)
		setNonce(0)
		setScreen('welcome')
	}

	if (booting) {
		return (
			<div className="auth-shell auth-shell--center">
				<div className="loading-state">
					<span className="spinner" aria-hidden="true" />
					<p>Menyiapkan vault lokal…</p>
				</div>
			</div>
		)
	}

	if (bootError) {
		return (
			<div className="auth-shell auth-shell--center">
				<Notice variant="error">{`Gagal menyiapkan penyimpanan: ${bootError}`}</Notice>
			</div>
		)
	}

	if (!wallet) {
		return (
			<div className="auth-shell">
				<header className="auth-header">
					<div className="brand brand--dark">
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
		? 'RPC offline'
		: loading
			? 'Menghubungkan…'
			: chainId !== undefined
				? `Chain ${chainId}`
				: 'Terhubung'

	return (
		<div className="app-shell">
			<header className="app-header">
				<div className="app-header__inner">
					<div className="brand brand--dark">
						<span className="brand-mark" aria-hidden="true">
							<Icon name="diamond" size={16} />
						</span>
						<span>
							<strong>NexChain</strong>
							<small>Wallet</small>
						</span>
					</div>
					<nav className="primary-nav" aria-label="Wallet navigation">
						{(Object.keys(TAB_LABELS) as Tab[]).map((value) => (
							<button
								key={value}
								type="button"
								className={`nav-link ${tab === value ? 'nav-link--active' : ''}`}
								onClick={() => setTab(value)}
								aria-current={tab === value ? 'page' : undefined}
							>
								<Icon name={TAB_ICONS[value]} size={15} aria-hidden="true" />
								<span>{TAB_LABELS[value]}</span>
							</button>
						))}
					</nav>
					<div className="header-actions">
						<span className={`network-pill network-pill--${networkState}`} title={networkLabel}>
							<span className="network-dot" aria-hidden="true" />
							<span>{networkLabel}</span>
						</span>
						<button type="button" className="button button--ghost button--sm" onClick={handleLock}>
							<Icon name="lock" size={14} aria-hidden="true" />
							<span>Kunci</span>
						</button>
					</div>
				</div>
			</header>

			<main className="content">
				{netError ? (
					<Notice
						variant="error"
						action={{ label: 'Retry', onClick: () => void refresh(wallet.address) }}
					>
						RPC belum dapat dihubungi. Periksa URL node di Settings.
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
						refresh={() => void refresh(wallet.address)}
						setTab={setTab}
					/>
				) : null}
				{tab === 'kirim' ? (
					<Send
						sender={wallet.address}
						privateKey={wallet.privateKey}
						balance={balance}
						setTab={setTab}
						onSent={() => void refresh(wallet.address)}
					/>
				) : null}
				{tab === 'terima' ? <Receive address={wallet.address} /> : null}
				{tab === 'riwayat' ? <History address={wallet.address} setTab={setTab} /> : null}
				{tab === 'pengaturan' ? (
					<Settings
						mnemonic={wallet.mnemonic}
						onLock={handleLock}
						onWipe={handleWipe}
					/>
				) : null}
			</main>
		</div>
	)
}
