import { useCallback, useEffect, useState } from 'react'
import { getVault } from './lib/vault'
import type { UnlockedWallet, WalletVault } from 'client/wallet/walletVault'
import { fetchAccount, fetchChainId, fetchNextNonce, fetchPending } from './lib/rpc'
import type { Screen, Tab } from './types'
import { Icon } from './ui/Icon'
import type { IconName } from './ui/Icon'
import { Welcome } from './screens/Welcome'
import { SetupWallet } from './screens/SetupWallet'
import { Unlock } from './screens/Unlock'
import { Dashboard } from './screens/Dashboard'
import { Send } from './screens/Send'
import { Receive } from './screens/Receive'
import { History } from './screens/History'
import { Settings } from './screens/Settings'
import { errorMessage } from './lib/format'

/** Ikon per tab — presentasi murni. */
const TAB_ICONS: Record<Tab, IconName> = {
	ringkasan: 'home',
	kirim: 'arrowUpRight',
	terima: 'arrowDownLeft',
	riwayat: 'clock',
	pengaturan: 'sliders',
}

/**
 * Aplikasi wallet browser (Phase D).
 *
 * Status aplikasi = dua dimensi independen:
 *   1. `screen`  — alur terkunci (welcome/create/import/unlock)
 *   2. `tab`     — tab utama, hanya berlaku saat vault terbuka
 *
 * Vault (Phase C) adalah SATU instance per sesi; private key hidup hanya di
 * memori vault. Reload halaman → vault terkunci lagi → layar unlock.
 */
export const App = (): React.JSX.Element => {
	// ---- status vault ----
	const [vault, setVault] = useState<WalletVault | undefined>()
	const [wallet, setWallet] = useState<UnlockedWallet | undefined>()
	const [screen, setScreen] = useState<Screen>('welcome')
	const [booting, setBooting] = useState(true)
	const [bootError, setBootError] = useState('')
	const [tab, setTab] = useState<Tab>('ringkasan')

	// ---- data jaringan ----
	const [balance, setBalance] = useState(0)
	const [pending, setPending] = useState(0)
	const [nonce, setNonce] = useState(0)
	const [chainId, setChainId] = useState<number>(26)
	const [loading, setLoading] = useState(false)
	const [netError, setNetError] = useState('')

	/** Ambil saldo/pending/nonce/chainId untuk alamat aktif. */
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

	/** Boot: buka vault sekali, lalu tentukan layar awal. */
	useEffect(() => {
		let alive = true
		void (async () => {
			try {
				const instance = await getVault()
				if (!alive) return
				setVault(instance)
				if (instance.isUnlocked()) {
					// Refresh jaringan TIDAK ditunggu di sini: efek `wallet` di bawah
					// yang memicunya, jadi layar tidak tertahan bila node sedang mati.
					setWallet(instance.getUnlocked())
				} else if (await instance.hasWallet()) {
					setScreen('unlock')
				} else {
					setScreen('welcome')
				}
			} catch (error) {
				if (alive) setBootError(errorMessage(error))
			} finally {
				if (alive) setBooting(false)
			}
		})()
		return () => {
			alive = false
		}
	}, [refresh])

	// Refresh berkala selama tab terbuka — seluruh data berasal dari RPC.
	useEffect(() => {
		if (!wallet) return
		void refresh(wallet.address)
		const timer = setInterval(() => void refresh(wallet.address), 15_000)
		return () => clearInterval(timer)
	}, [wallet, refresh])

	// ---- aksi vault ----
	/**
	 * Buka sesi terkunci TANPA menunggu RPC.
	 *
	 * Sebelumnya `await refresh(...)` di sini membuat tombol "Buka"/"Simpan"
	 * berputar sampai 4 request pertama selesai (atau menggantung bila node
	 * mati — `fetch` tanpa timeout). Refresh dipicu oleh efek `wallet`, jadi
	 * data tetap terisi, hanya tidak menahan alur unlock.
	 */
	const enterWallet = (instance: WalletVault): void => {
		setWallet(instance.getUnlocked())
		setTab('ringkasan')
	}

	const handleSetup = async (mnemonic: string, passphrase: string): Promise<void> => {
		if (!vault) throw new Error('Vault belum siap.')
		// Untuk create MAUPUN import: frasa yang ditampilkan di layar diimpor
		// balik, sehingga wallet = frasa yang dilihat & dicatat user (bukan
		// frasa lain yang dibangkitkan `vault.create` di belakang layar).
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
		if (!window.confirm('Hapus wallet dari perangkat ini? TANPA mnemonic cadangan, dana tidak bisa dipulihkan.')) {
			return
		}
		await vault.wipe()
		setWallet(undefined)
		setBalance(0)
		setPending(0)
		setNonce(0)
		setScreen('welcome')
	}

	// ---- render ----
	if (booting) {
		return (
			<div className="shell center">
				<div className="boot">
					<span className="spinner" aria-hidden="true" />
					<p className="muted">Menyiapkan wallet…</p>
				</div>
			</div>
		)
	}

	if (bootError) {
		return (
			<div className="shell center">
				<p className="error">Gagal menyiapkan penyimpanan: {bootError}</p>
			</div>
		)
	}

	// ---- alur terkunci ----
	if (!wallet) {
		return (
			<div className="shell center">
				{screen === 'unlock' && vault ? (
					<Unlock onUnlock={handleUnlock} go={setScreen} />
				) : screen === 'create' || screen === 'import' ? (
					<SetupWallet mode={screen} onDone={handleSetup} go={setScreen} />
				) : (
					<Welcome go={setScreen} />
				)}
			</div>
		)
	}

	// ---- sesi terbuka ----
	return (
		<div className="shell">
			<header className="topbar">
				<span className="brand">
					<span className="brand-mark" aria-hidden="true">
						<Icon name="diamond" size={13} />
					</span>
					NexChain Wallet
				</span>
				<nav className="tabs">
					{(
						[
							['ringkasan', 'Ringkasan'],
							['kirim', 'Kirim'],
							['terima', 'Terima'],
							['riwayat', 'Riwayat'],
							['pengaturan', 'Pengaturan'],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							className={tab === value ? 'tab active' : 'tab'}
							onClick={() => setTab(value)}
							aria-current={tab === value ? 'page' : undefined}
						>
							<Icon name={TAB_ICONS[value]} size={15} />
							{label}
						</button>
					))}
				</nav>
				<button className="lock" onClick={handleLock} aria-label="Kunci wallet">
					<Icon name="lock" size={14} />
					Kunci
				</button>
			</header>

			<main className="content">
				{netError ? <p className="error banner">RPC: {netError}</p> : null}

				{tab === 'ringkasan' && (
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
				)}
				{tab === 'kirim' && (
					<Send
						sender={wallet.address}
						privateKey={wallet.privateKey}
						balance={balance}
						setTab={setTab}
						onSent={() => void refresh(wallet.address)}
					/>
				)}
				{tab === 'terima' && <Receive address={wallet.address} setTab={setTab} />}
				{tab === 'riwayat' && <History address={wallet.address} setTab={setTab} />}
				{tab === 'pengaturan' && (
					<Settings
						mnemonic={wallet.mnemonic}
						onLock={handleLock}
						onWipe={() => void handleWipe()}
						setTab={setTab}
					/>
				)}
			</main>
		</div>
	)
}
