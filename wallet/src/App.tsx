import { useCallback, useEffect, useRef, useState } from 'react'
import { getVault } from './lib/vault'
import type { UnlockedWallet, WalletVault } from 'src/client/wallet/walletVault'
import {
	fetchAccount,
	fetchChainId,
	fetchPending,
	fetchSyncStatus,
} from './lib/rpc'
import type { Screen, View, WalletAction } from './types'
import { Icon } from './ui/Icon'
import { Notice } from './ui/Notice'
import { useAutoLock } from './hooks/useAutoLock'
import { useVisibleInterval } from './hooks/useVisibleInterval'
import { Welcome } from './screens/Welcome'
import { SetupWallet } from './screens/SetupWallet'
import { Unlock } from './screens/Unlock'
import { Home } from './screens/Home'
import { History } from './screens/History'
import { Send } from './screens/Send'
import { Receive } from './screens/Receive'
import { Settings } from './screens/Settings'
import { errorMessage } from './lib/format'
import { installTheme } from './lib/theme'

// Dipasang sebelum render pertama supaya tidak ada kedipan tema terang.
installTheme()

/**
 * Jeda poll saldo. 30 detik, bukan 15: tiap tick mengirim tiga request RPC,
 * dan di PWA HP itu membangunkan radio terus-menerus untuk angka yang jarang
 * berubah. Muat ulang manual tetap tersedia lewat tombol Segarkan.
 */
const POLL_MS = 30_000

/**
 * Chain ID PERTAMA yang pernah dilihat wallet ini.
 *
 * Node bisa diganti lewat Settings, dan alamat yang sama di chain lain adalah
 * akun yang sama sekali berbeda. Tanpa pengingat, pindah node tampak seperti
 * saldo yang "hilang" (atau lebih buruk: saldo orang lain) tanpa gejala.
 */
const CHAIN_KEY = 'nex_chain_id'

export const App = (): React.JSX.Element => {
	const [vault, setVault] = useState<WalletVault | undefined>()
	const [wallet, setWallet] = useState<UnlockedWallet | undefined>()
	const [screen, setScreen] = useState<Screen>('welcome')
	const [booting, setBooting] = useState(true)
	const [bootError, setBootError] = useState('')
	const [view, setView] = useState<View>('beranda')
	/** Sheet aksi yang terbuka di atas layar aktif. */
	const [action, setAction] = useState<WalletAction>(null)
	/** Naik setiap transaksi terkirim — memicu daftar aktivitas memuat ulang. */
	const [activityVersion, setActivityVersion] = useState(0)

	const [balance, setBalance] = useState(0)
	const [pending, setPending] = useState(0)
	const [chainId, setChainId] = useState<number | undefined>()
	/**
	 * `refreshing` = permintaan yang DIPICU USER sedang berjalan (mematikan dan
	 * memberi label tombol Segarkan). Poll latar sengaja tidak menyentuhnya:
	 * tombol yang berkedip "Memuat…" tiap 30 detik membuat layar terasa
	 * me-reload padahal angkanya cuma diperbarui.
	 *
	 * `loaded` = PERNAH ada satu jawaban sukses untuk wallet ini. Selama masih
	 * false/offline, saldo ditampilkan "—": menampilkan `0` saat RPC mati
	 * adalah pernyataan palsu tentang dana pengguna.
	 */
	const [refreshing, setRefreshing] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [netError, setNetError] = useState('')
	const [syncing, setSyncing] = useState(false)
	/** Peringatan chain berbeda — string kosong = tidak ada. */
	const [chainWarning, setChainWarning] = useState('')
	/**
	 * Chain ID tidak pernah berubah selama sesi, jadi ia diambil SEKALI lalu
	 * di-cache di ref — bukan bagian dari poll.
	 */
	const chainIdRef = useRef<number | undefined>(undefined)

	const refresh = useCallback(
		async (address: string, options?: { silent?: boolean }): Promise<void> => {
			const silent = options?.silent === true
			if (!silent) setRefreshing(true)
			setNetError('')
			try {
				const [account, pendingInfo, sync] = await Promise.all([
					fetchAccount(address),
					fetchPending(address),
					fetchSyncStatus().catch(() => undefined),
				])
				setBalance(account?.balance ?? 0)
				setPending(pendingInfo?.pendingAmount ?? 0)
				setSyncing(sync?.syncing === true)
				setLoaded(true)

				if (chainIdRef.current === undefined) {
					const id = await fetchChainId()
					if (typeof id === 'number') {
						chainIdRef.current = id
						setChainId(id)
						try {
							const seen = localStorage.getItem(CHAIN_KEY)
							if (seen === null) localStorage.setItem(CHAIN_KEY, String(id))
							else if (seen !== String(id))
								setChainWarning(
									`Node ini melayani chain ${id}, sedangkan wallet ini terakhir memakai chain ${seen}. Saldo dan riwayat berasal dari jaringan yang berbeda.`,
								)
						} catch {
							// localStorage diblokir → guard chain tidak tersedia; itu bukan
							// kegagalan koneksi, jadi jangan tampilkan "offline".
						}
					}
				}
			} catch (error) {
				setNetError(errorMessage(error))
			} finally {
				if (!silent) setRefreshing(false)
			}
		},
		[],
	)

	/** Konfirmasi pindah jaringan: simpan chain baru dan hilangkan peringatan. */
	const adoptChain = (): void => {
		if (chainId === undefined) return
		try {
			localStorage.setItem(CHAIN_KEY, String(chainId))
		} catch {
			// diblokir → peringatan hilang untuk sesi ini saja
		}
		setChainWarning('')
	}

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

	/**
	 * Poll saldo tiap 30 detik, BERHENTI saat aplikasi tidak terlihat — lihat
	 * `useVisibleInterval` untuk alasannya (baterai di HP).
	 *
	 * `silent: loaded` = poll pertama (belum pernah sukses) tetap memakai
	 * indikator tombol, poll berikutnya tidak. Nilai `loaded` dibaca dari
	 * render terakhir karena hook menyimpan closure di ref.
	 */
	useVisibleInterval(
		() => {
			if (wallet) void refresh(wallet.address, { silent: loaded })
		},
		POLL_MS,
		Boolean(wallet),
	)

	const enterWallet = (instance: WalletVault): void => {
		setWallet(instance.getUnlocked())
		setView('beranda')
		setAction(null)
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
		setLoaded(false)
		setSyncing(false)
		setAction(null)
		setView('beranda')
		setScreen('unlock')
	}

	const handleWipe = async (): Promise<void> => {
		if (!vault) return
		await vault.wipe()
		setWallet(undefined)
		setBalance(0)
		setPending(0)
		setLoaded(false)
		setSyncing(false)
		setChainWarning('')
		// Wallet baru bisa memakai jaringan lain — cache chain harus dibuang.
		chainIdRef.current = undefined
		setChainId(undefined)
		setAction(null)
		setView('beranda')
		setScreen('welcome')
	}

	/** Transaksi terkirim: segarkan saldo dan cuplikan aktivitas di Ringkasan. */
	const handleSent = (): void => {
		setActivityVersion((value) => value + 1)
		if (wallet) void refresh(wallet.address)
	}

	/**
	 * Kembali dari Pengaturan: node/explorer bisa saja baru diganti, jadi saldo
	 * dan riwayat dimuat ulang — kalau tidak, daftar lama tetap tampil sampai
	 * poll berikutnya (dan riwayat tidak ikut poll).
	 */
	const handleBackHome = (): void => {
		setView('beranda')
		setActivityVersion((value) => value + 1)
		if (wallet) void refresh(wallet.address)
	}

	/**
	 * Kunci otomatis setelah 5 menit di background. Hanya aktif saat ada wallet
	 * terbuka — kalau tidak, layar buka kunci sudah tampil dan tidak ada yang
	 * perlu dikunci.
	 */
	useAutoLock(handleLock, Boolean(wallet))

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

	const networkState = netError
		? 'offline'
		: loaded
			? 'connected'
			: 'connecting'
	const networkLabel = netError
		? 'RPC offline'
		: !loaded
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
					<div className="header-actions">
						<span
							className={`network-pill network-pill--${networkState}`}
							title={networkLabel}
						>
							<span className="network-dot" aria-hidden="true" />
							<span>{networkLabel}</span>
						</span>
						<button
							type="button"
							className="icon-button"
							onClick={handleLock}
							aria-label="Kunci wallet"
							title="Kunci wallet"
						>
							<Icon name="lock" size={16} aria-hidden="true" />
						</button>
						<button
							type="button"
							className={`icon-button ${view === 'pengaturan' ? 'icon-button--active' : ''}`}
							onClick={() =>
								setView(view === 'pengaturan' ? 'beranda' : 'pengaturan')
							}
							aria-label={
								view === 'pengaturan' ? 'Tutup pengaturan' : 'Buka pengaturan'
							}
							aria-pressed={view === 'pengaturan'}
							title="Pengaturan"
						>
							<Icon name="sliders" size={16} aria-hidden="true" />
						</button>
					</div>
				</div>
			</header>

			<main className="content">
				{netError ? (
					<Notice
						variant="error"
						action={{
							label: 'Coba lagi',
							onClick: () => void refresh(wallet.address),
						}}
					>
						{`RPC belum dapat dihubungi (${netError}). Saldo tidak diketahui sampai terhubung — periksa URL node di Pengaturan.`}
					</Notice>
				) : null}

				{chainWarning ? (
					<Notice
						variant="warn"
						action={{ label: 'Gunakan chain ini', onClick: adoptChain }}
						onDismiss={() => setChainWarning('')}
					>
						{chainWarning}
					</Notice>
				) : null}

				{syncing && !netError ? (
					<Notice variant="info">
						Node sedang menyinkronkan rantai. Saldo dan riwayat bisa tertinggal
						sampai sinkronisasi selesai.
					</Notice>
				) : null}

				{view === 'beranda' ? (
					<Home
						address={wallet.address}
						privateKey={wallet.privateKey}
						balance={balance}
						pending={pending}
						loaded={loaded}
						refreshing={refreshing}
						refresh={() => void refresh(wallet.address)}
						activityVersion={activityVersion}
						onSend={() => setAction('kirim')}
						onReceive={() => setAction('terima')}
						onChanged={handleSent}
						onViewAll={() => setView('riwayat')}
					/>
				) : view === 'riwayat' ? (
					<History
						address={wallet.address}
						privateKey={wallet.privateKey}
						activityVersion={activityVersion}
						onChanged={handleSent}
						onBack={handleBackHome}
					/>
				) : (
					<Settings
						mnemonic={wallet.mnemonic}
						onLock={handleLock}
						onWipe={handleWipe}
						onBack={handleBackHome}
					/>
				)}
			</main>

			<Send
				open={action === 'kirim'}
				sender={wallet.address}
				balance={balance}
				pending={pending}
				privateKey={wallet.privateKey}
				onClose={() => setAction(null)}
				onSent={handleSent}
			/>
			<Receive
				open={action === 'terima'}
				address={wallet.address}
				onClose={() => setAction(null)}
			/>
		</div>
	)
}
