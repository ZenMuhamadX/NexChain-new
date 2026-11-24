import { useCallback, useEffect, useState } from 'react'
import {
	buildSignedTransaction,
	createIdbKV,
	createWalletVault,
	fetchAccount,
	fetchActivityPage,
	fetchNextNonce,
	genRandomMnemonic,
	sendRawTransaction,
	txHashOf,
	authCheck,
	type ActivityPage,
	type SendForm,
	type TxInterface,
	type WalletInfo,
	type WalletVault,
} from '../index'
import {
	applyRpcConfig,
	DEFAULT_RPC_CONFIG,
	ensureRpcOrigin,
	loadRpcConfig,
	saveRpcConfig,
	type RpcConfig,
} from '../shell/config'
import {
	ActivityScreen,
	HomeScreen,
	ImportScreen,
	NavBar,
	SetupScreen,
	SettingsScreen,
	UnlockScreen,
	WelcomeScreen,
	type AsyncData,
} from './screens'
import {
	ReceiveSheet,
	SendSheet,
	type PrepareResult,
	type SubmitResult,
} from './sheets'
import './theme.css'

type Phase = 'loading' | 'welcome' | 'setup' | 'import' | 'unlock' | 'ready'
type Route = 'home' | 'activity' | 'settings'
type Sheet = 'send' | 'receive' | undefined

const errorMessage = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught)

export const App = () => {
	const [phase, setPhase] = useState<Phase>('loading')
	const [bootError, setBootError] = useState<string>()
	const [vault, setVault] = useState<WalletVault>()
	const [info, setInfo] = useState<WalletInfo>()
	const [pendingMnemonic, setPendingMnemonic] = useState('')
	const [config, setConfig] = useState<RpcConfig>(DEFAULT_RPC_CONFIG)
	const [route, setRoute] = useState<Route>('home')
	const [sheet, setSheet] = useState<Sheet>()
	const [builtTx, setBuiltTx] = useState<TxInterface>()
	const [balance, setBalance] = useState<AsyncData<number>>({ loading: true })
	const [activity, setActivity] = useState<AsyncData<ActivityPage>>({
		loading: true,
	})
	const [loadingMore, setLoadingMore] = useState(false)
	const [loadMoreError, setLoadMoreError] = useState<string>()

	const address = info?.address

	useEffect(() => {
		let alive = true
		const boot = async () => {
			try {
				const kv = await createIdbKV('nex-wallet-new')
				const nextVault = createWalletVault(kv)
				const nextConfig = loadRpcConfig()
				applyRpcConfig(nextConfig)
				if (!alive) return
				setVault(nextVault)
				setConfig(nextConfig)
				const hasWallet = await nextVault.hasWallet()
				if (hasWallet) setInfo(await nextVault.getInfo())
				setPhase(hasWallet ? 'unlock' : 'welcome')
			} catch (caught) {
				if (alive) {
					setBootError(errorMessage(caught))
					setPhase('loading')
				}
			}
		}
		void boot()
		return () => {
			alive = false
		}
	}, [])

	const refresh = useCallback(async () => {
		if (!address) return
		setBalance({ loading: true })
		setActivity({ loading: true })
		setLoadingMore(false)
		setLoadMoreError(undefined)
		const [accountResult, activityResult] = await Promise.allSettled([
			fetchAccount(address),
			fetchActivityPage(address),
		])
		if (accountResult.status === 'fulfilled') {
			const account = accountResult.value
			setBalance(
				account
					? { data: account.balance, loading: false }
					: { error: 'Account not found on the node.', loading: false },
			)
		} else {
			setBalance({ error: errorMessage(accountResult.reason), loading: false })
		}
		if (activityResult.status === 'fulfilled') {
			setActivity({ data: activityResult.value, loading: false })
		} else {
			setActivity({
				error: errorMessage(activityResult.reason),
				loading: false,
			})
		}
	}, [address])

	const loadMore = useCallback(async () => {
		const current = activity.data
		if (!address || loadingMore || !current) return
		if (current.page >= current.totalPages) return
		setLoadingMore(true)
		setLoadMoreError(undefined)
		try {
			const next = await fetchActivityPage(address, current.page + 1)
			setActivity((previous) => {
				const base = previous.data
				if (!base) return previous
				const seen = new Set(
					base.rows
						.map((row) => row.tx.txHash)
						.filter((hash): hash is string => typeof hash === 'string'),
				)
				const fresh = next.rows.filter(
					(row) =>
						typeof row.tx.txHash !== 'string' || !seen.has(row.tx.txHash),
				)
				return {
					...previous,
					data: { ...next, rows: [...base.rows, ...fresh] },
				}
			})
		} catch (caught) {
			setLoadMoreError(errorMessage(caught))
		} finally {
			setLoadingMore(false)
		}
	}, [address, activity.data, loadingMore])

	const revealSecret = useCallback(
		async (
			passphrase: string,
			kind: 'mnemonic' | 'privateKey',
		): Promise<string> => {
			if (!vault) throw new Error('Vault is not ready.')
			await vault.unlock(passphrase)
			const unlocked = vault.getUnlocked()
			return kind === 'mnemonic' ? unlocked.mnemonic : unlocked.privateKey
		},
		[vault],
	)

	useEffect(() => {
		if (phase !== 'ready') return
		void refresh()
	}, [phase, refresh])

	const startCreate = () => {
		setPendingMnemonic(genRandomMnemonic())
		setPhase('setup')
	}

	const finishCreate = async (passphrase: string) => {
		if (!vault) throw new Error('Vault is not ready.')
		const created = await vault.importMnemonic(pendingMnemonic, passphrase)
		setPendingMnemonic('')
		setInfo(created)
		setPhase('ready')
	}

	const finishImport = async (mnemonic: string, passphrase: string) => {
		if (!vault) throw new Error('Vault is not ready.')
		const imported = await vault.importMnemonic(mnemonic, passphrase, {
			replace: info !== undefined,
		})
		setInfo(imported)
		setPhase('ready')
	}

	const unlock = async (passphrase: string) => {
		if (!vault) throw new Error('Vault is not ready.')
		const unlocked = await vault.unlock(passphrase)
		setInfo(unlocked)
		setPhase('ready')
	}

	const prepareSend = async (form: SendForm): Promise<PrepareResult> => {
		if (!vault || !address) return { error: 'Wallet is not ready.' }
		try {
			const { privateKey } = vault.getUnlocked()
			const nonce = await fetchNextNonce(address)
			const built = await buildSignedTransaction(
				form,
				address,
				privateKey,
				nonce,
			)
			if (!built.ok || !built.tx) {
				return { error: built.error ?? 'Could not build the transaction.' }
			}
			setBuiltTx(built.tx)
			return { fee: built.fee }
		} catch (caught) {
			return { error: errorMessage(caught) }
		}
	}

	const submitSend = async (): Promise<SubmitResult> => {
		if (!builtTx) return { error: 'Transaction not found.' }
		try {
			const result = await sendRawTransaction(builtTx)
			if (!result.status) {
				return { error: result.error ?? 'The node rejected the transaction.' }
			}
			setBuiltTx(undefined)
			await refresh()
			return { txHash: result.txHash ?? txHashOf(builtTx) ?? '' }
		} catch (caught) {
			return { error: errorMessage(caught) }
		}
	}

	const saveConfigNext = async (
		next: RpcConfig,
	): Promise<string | undefined> => {
		const granted = await ensureRpcOrigin(next.url)
		if (!granted) return 'Access to the RPC origin was denied.'
		saveRpcConfig(next)
		setConfig(next)
		try {
			await authCheck()
			await refresh()
			return 'Settings saved and the node responded.'
		} catch (caught) {
			return `Settings saved, but the node did not respond: ${errorMessage(caught)}`
		}
	}

	const closeSheet = () => {
		setSheet(undefined)
		setBuiltTx(undefined)
	}

	if (phase === 'loading') {
		return (
			<div className="app">
				<main className="frame frame-center">
					{bootError ? (
						<div className="state-card">
							<p>Wallet storage could not be opened: {bootError}</p>
							<button
								type="button"
								className="btn btn-primary"
								aria-label="Try again"
								onClick={() => window.location.reload()}
							>
								Try again
							</button>
						</div>
					) : (
						<p className="state-line">Preparing wallet...</p>
					)}
				</main>
			</div>
		)
	}

	return (
		<div className="app">
			<main className="frame">
				{phase === 'welcome' ? (
					<WelcomeScreen
						onCreate={startCreate}
						onImport={() => setPhase('import')}
					/>
				) : null}
				{phase === 'setup' ? (
					<SetupScreen
						mnemonic={pendingMnemonic}
						onBack={() => setPhase('welcome')}
						onConfirm={finishCreate}
					/>
				) : null}
				{phase === 'import' ? (
					<ImportScreen
						onBack={() => setPhase(info ? 'unlock' : 'welcome')}
						onImport={finishImport}
					/>
				) : null}
				{phase === 'unlock' ? (
					<UnlockScreen
						address={info?.address ?? ''}
						onUnlock={unlock}
						onImport={() => setPhase('import')}
					/>
				) : null}
				{phase === 'ready' && info && vault ? (
					<>
						<div className="screen-scroll" key={route}>
							{route === 'home' ? (
								<HomeScreen
									address={info.address}
									balance={balance}
									activity={activity}
									onRefresh={() => void refresh()}
									onSend={() => setSheet('send')}
									onReceive={() => setSheet('receive')}
								/>
							) : null}
							{route === 'activity' ? (
								<ActivityScreen
									address={info.address}
									activity={activity}
									loadingMore={loadingMore}
									loadMoreError={loadMoreError}
									onLoadMore={() => void loadMore()}
									onRefresh={() => void refresh()}
								/>
							) : null}
							{route === 'settings' ? (
								<SettingsScreen
									config={config}
									address={info.address}
									publicKey={info.publicKey}
									onRevealSecret={revealSecret}
									onSave={saveConfigNext}
									onLock={() => {
										vault.lock()
										setPhase('unlock')
									}}
									onWipe={() => {
										if (!window.confirm('Delete this wallet from this device?'))
											return
										void vault.wipe().then(() => {
											setInfo(undefined)
											setBuiltTx(undefined)
											setPhase('welcome')
										})
									}}
								/>
							) : null}
						</div>
						<NavBar route={route} onNavigate={setRoute} />
					</>
				) : null}
				{sheet && info ? (
					sheet === 'send' ? (
						<SendSheet
							address={info.address}
							availableNexu={balance.data ?? 0}
							onClose={closeSheet}
							onPrepare={prepareSend}
							onSubmit={submitSend}
						/>
					) : (
						<ReceiveSheet address={info.address} onClose={closeSheet} />
					)
				) : null}
			</main>
		</div>
	)
}
