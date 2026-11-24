import { useEffect, useState, type CSSProperties } from 'react'
import blockchainLogo from '../../../brand/asset/nexchain_blockchain_transparent.svg'
import nxcTicker from '../../../brand/asset/nxc_ticker_transparent.svg'
import { formatNxc } from '../index'
import type { ActivityPage } from '../rpc'
import type { RpcConfig } from '../shell/config'
import {
	DEFAULT_EXPLORER_URL,
	explorerTxUrl,
	getExplorerUrl,
	persistExplorerUrl,
} from '../shell/explorer'
import { Icon, type IconName } from './Icon'
import { SecretReveal } from './SecretReveal'

export interface AsyncData<T> {
	data?: T
	loading: boolean
	error?: string
}

export const shortHash = (value: string): string =>
	value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value

/** Deterministic avatar hue from the address: no image asset needed. */
const avatarStyle = (address: string): CSSProperties => {
	const hue = parseInt(address.slice(3, 9), 16) % 360
	return {
		background: `linear-gradient(140deg, hsl(${hue} 62% 58%), hsl(${(hue + 55) % 360} 58% 42%))`,
	}
}

const Brand = () => (
	<div className="brand">
		<img className="brand-mark" src={blockchainLogo} alt="" />
		<span>NexChain</span>
	</div>
)

export const CopyButton = ({ value }: { value: string }) => {
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (!copied) return
		const timer = window.setTimeout(() => setCopied(false), 1600)
		return () => window.clearTimeout(timer)
	}, [copied])

	return (
		<button
			type="button"
			className="btn btn-quiet btn-small"
			aria-label={copied ? 'Copied' : 'Copy to clipboard'}
			onClick={() => {
				void navigator.clipboard.writeText(value).then(() => setCopied(true))
			}}
		>
			<Icon name={copied ? 'check' : 'copy'} size={16} />
			{copied ? 'Copied' : 'Copy'}
		</button>
	)
}

const FieldError = ({ message }: { message?: string }) =>
	message ? (
		<p className="field-error" role="alert">
			<Icon name="alert" size={15} />
			{message}
		</p>
	) : null

const PassphraseField = ({
	value,
	onChange,
	label = 'Passphrase',
}: {
	value: string
	onChange: (value: string) => void
	label?: string
}) => {
	const [visible, setVisible] = useState(false)
	return (
		<label className="field">
			<span>{label}</span>
			<span className="input-wrap">
				<input
					type={visible ? 'text' : 'password'}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					autoComplete="current-password"
					required
				/>
				<button
					type="button"
					className="icon-button"
					aria-label={visible ? 'Hide passphrase' : 'Show passphrase'}
					onClick={() => setVisible((current) => !current)}
				>
					<Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
				</button>
			</span>
		</label>
	)
}

export const WelcomeScreen = ({
	onCreate,
	onImport,
}: {
	onCreate: () => void
	onImport: () => void
}) => (
	<div className="screen screen-auth">
		<Brand />
		<div className="hero">
			<img className="hero-mark" src={blockchainLogo} alt="" />
			<h1>Your wallet for NXC.</h1>
			<p>
				Your keys are encrypted on this device. You hold the mnemonic, and we
				never store it.
			</p>
		</div>
		<div className="stack">
			<button
				type="button"
				className="btn btn-primary"
				aria-label="Create new wallet"
				onClick={onCreate}
			>
				Create new wallet
			</button>
			<button
				type="button"
				className="btn btn-secondary"
				aria-label="Import mnemonic"
				onClick={onImport}
			>
				Import mnemonic
			</button>
		</div>
	</div>
)

export const SetupScreen = ({
	mnemonic,
	onBack,
	onConfirm,
}: {
	mnemonic: string
	onBack: () => void
	onConfirm: (passphrase: string) => Promise<void>
}) => {
	const [saved, setSaved] = useState(false)
	const [passphrase, setPassphrase] = useState('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const words = mnemonic.split(' ').filter(Boolean)

	const submit = async () => {
		setBusy(true)
		setError(undefined)
		try {
			await onConfirm(passphrase)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="screen">
			<div className="screen-head">
				<button
					type="button"
					className="icon-button"
					aria-label="Back"
					onClick={onBack}
				>
					<Icon name="close" size={18} />
				</button>
				<h2>Save your mnemonic</h2>
			</div>
			<p className="lede">
				This is the only way to recover your wallet. Write the words down in
				order and keep them somewhere safe.
			</p>
			<div className="mnemonic-grid">
				{words.map((word, index) => (
					<div className="mnemonic-word" key={`${index}-${word}`}>
						<span>{index + 1}</span>
						<strong>{word}</strong>
					</div>
				))}
			</div>
			<CopyButton value={mnemonic} />
			<label className="check-row">
				<input
					type="checkbox"
					checked={saved}
					onChange={(event) => setSaved(event.target.checked)}
				/>
				<span>I have saved it</span>
			</label>
			<form
				className="stack"
				onSubmit={(event) => {
					event.preventDefault()
					void submit()
				}}
			>
				<PassphraseField value={passphrase} onChange={setPassphrase} />
				<FieldError message={error} />
				<button
					type="submit"
					className="btn btn-primary"
					disabled={!saved || passphrase.length < 8 || busy}
					aria-label="Finish creating wallet"
				>
					{busy ? 'Setting up...' : 'Finish'}
				</button>
			</form>
		</div>
	)
}

export const ImportScreen = ({
	onBack,
	onImport,
}: {
	onBack: () => void
	onImport: (mnemonic: string, passphrase: string) => Promise<void>
}) => {
	const [mnemonic, setMnemonic] = useState('')
	const [passphrase, setPassphrase] = useState('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	const submit = async () => {
		setBusy(true)
		setError(undefined)
		try {
			await onImport(mnemonic, passphrase)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="screen">
			<div className="screen-head">
				<button
					type="button"
					className="icon-button"
					aria-label="Back"
					onClick={onBack}
				>
					<Icon name="close" size={18} />
				</button>
				<h2>Import wallet</h2>
			</div>
			<form
				className="stack"
				onSubmit={(event) => {
					event.preventDefault()
					void submit()
				}}
			>
				<label className="field">
					<span>Mnemonic</span>
					<textarea
						value={mnemonic}
						onChange={(event) => setMnemonic(event.target.value)}
						rows={4}
						placeholder="your mnemonic words"
						required
					/>
				</label>
				<PassphraseField value={passphrase} onChange={setPassphrase} />
				<FieldError message={error} />
				<button
					type="submit"
					className="btn btn-primary"
					disabled={busy || !mnemonic.trim() || passphrase.length < 8}
					aria-label="Import mnemonic"
				>
					{busy ? 'Importing...' : 'Import'}
				</button>
			</form>
		</div>
	)
}

export const UnlockScreen = ({
	address,
	onUnlock,
	onImport,
}: {
	address: string
	onUnlock: (passphrase: string) => Promise<void>
	onImport: () => void
}) => {
	const [passphrase, setPassphrase] = useState('')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	const submit = async () => {
		setBusy(true)
		setError(undefined)
		try {
			await onUnlock(passphrase)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="screen screen-auth">
			<Brand />
			<div className="hero hero-tight">
				<span className="hero-mark">
					<Icon name="lock" size={34} />
				</span>
				<h1>Welcome back.</h1>
				<p className="mono">{shortHash(address)}</p>
			</div>
			<form
				className="stack"
				onSubmit={(event) => {
					event.preventDefault()
					void submit()
				}}
			>
				<PassphraseField value={passphrase} onChange={setPassphrase} />
				<FieldError message={error} />
				<button
					type="submit"
					className="btn btn-primary"
					disabled={busy || !passphrase}
					aria-label="Unlock wallet"
				>
					{busy ? 'Unlocking...' : 'Unlock wallet'}
				</button>
				<button
					type="button"
					className="btn btn-link"
					aria-label="Import another wallet"
					onClick={onImport}
				>
					Import another wallet
				</button>
			</form>
		</div>
	)
}

const ActivityRows = ({
	activity,
	address,
	limit,
}: {
	activity: AsyncData<ActivityPage>
	address: string
	limit?: number
}) => {
	if (activity.loading) {
		return <p className="state-line">Loading activity from the node...</p>
	}
	if (activity.error) {
		return (
			<div className="state-card">
				<Icon name="alert" size={18} />
				<p>{activity.error}</p>
			</div>
		)
	}
	const rows = (activity.data?.rows ?? []).slice(0, limit)
	if (rows.length === 0) {
		return (
			<div className="state-card">
				<p>No activity for this address yet.</p>
			</div>
		)
	}
	return (
		<ul className="activity-list">
			{rows.map(({ tx, pending }, index) => {
				const outgoing = tx.from === address
				const self = outgoing && tx.receiver === address
				const label = self ? 'To yourself' : outgoing ? 'Sent' : 'Received'
				const explorerHref = tx.txHash ? explorerTxUrl(tx.txHash) : ''
				return (
					<li className="activity-row" key={tx.txHash ?? `pending-${index}`}>
						<span className={`activity-icon ${outgoing ? 'is-out' : 'is-in'}`}>
							<Icon name={outgoing ? 'send' : 'receive'} size={17} />
						</span>
						<span className="activity-main">
							<strong>{label}</strong>
							<small className="mono">
								{tx.txHash ? shortHash(tx.txHash) : 'hash pending'}
							</small>
						</span>
						<span className="activity-amount">
							<strong>
								{outgoing ? '-' : '+'}
								{formatNxc(tx.amount, 4)} NXC
							</strong>
							{pending ? <small className="pending">Pending</small> : null}
						</span>
						{explorerHref ? (
							<a
								className="activity-explorer"
								href={explorerHref}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`View ${tx.txHash} in Explorer`}
							>
								<Icon name="external" size={16} />
							</a>
						) : null}
					</li>
				)
			})}
		</ul>
	)
}

export const HomeScreen = ({
	address,
	balance,
	activity,
	onRefresh,
	onSend,
	onReceive,
}: {
	address: string
	balance: AsyncData<number>
	activity: AsyncData<ActivityPage>
	onRefresh: () => void
	onSend: () => void
	onReceive: () => void
}) => {
	const [detailed, setDetailed] = useState(false)
	return (
		<div className="screen screen-home">
			<div className="screen-head account-head">
				<span
					className="account-avatar"
					style={avatarStyle(address)}
					aria-hidden="true"
				/>
				<span className="account-id mono">{shortHash(address)}</span>
				<CopyButton value={address} />
			</div>
			<section className="balance-card">
				<span className="balance-label">Balance</span>
				{balance.loading ? (
					<span
						className="skeleton skeleton-balance"
						aria-label="Loading balance"
					/>
				) : balance.error ? (
					<>
						<p className="balance-error">{balance.error}</p>
						<button
							type="button"
							className="btn btn-on-dark btn-small"
							aria-label="Try loading the balance again"
							onClick={onRefresh}
						>
							Try again
						</button>
					</>
				) : (
					<>
						<strong className="balance-value" key={balance.data}>
							{formatNxc(balance.data ?? 0, detailed ? undefined : 4)} NXC
						</strong>
						<button
							type="button"
							className="btn btn-on-dark btn-small"
							aria-label={
								detailed ? 'Show compact balance' : 'Show full balance'
							}
							onClick={() => setDetailed((current) => !current)}
						>
							{detailed ? 'Compact' : 'Full'}
						</button>
					</>
				)}
			</section>
			<div className="action-row">
				<button
					type="button"
					className="btn btn-soft action-tile"
					aria-label="Send NXC"
					onClick={onSend}
				>
					<span className="tile-icon">
						<Icon name="send" size={24} />
					</span>
					Send
				</button>
				<button
					type="button"
					className="btn btn-soft action-tile"
					aria-label="Receive NXC"
					onClick={onReceive}
				>
					<span className="tile-icon">
						<Icon name="qr" size={24} />
					</span>
					Receive
				</button>
			</div>
			<section className="section">
				<div className="section-head">
					<h3>Tokens</h3>
				</div>
				<div className="asset-card">
					<img className="asset-icon" src={nxcTicker} alt="" />
					<span className="asset-main">
						<strong>NXC</strong>
						<small>NexCoin</small>
					</span>
					{balance.loading ? (
						<span
							className="skeleton skeleton-asset"
							aria-label="Loading token balance"
						/>
					) : balance.error ? (
						<span className="asset-value">Unavailable</span>
					) : (
						<span className="asset-value mono">
							{formatNxc(balance.data ?? 0, 4)} NXC
						</span>
					)}
				</div>
			</section>
			<section className="section section-recent">
				<div className="section-head">
					<h3>Recent activity</h3>
				</div>
				<ActivityRows activity={activity} address={address} limit={5} />
			</section>
		</div>
	)
}

export const ActivityScreen = ({
	address,
	activity,
	loadingMore,
	loadMoreError,
	onLoadMore,
	onRefresh,
}: {
	address: string
	activity: AsyncData<ActivityPage>
	loadingMore: boolean
	loadMoreError?: string
	onLoadMore: () => void
	onRefresh: () => void
}) => {
	const data = activity.data
	const [spin, setSpin] = useState(0)
	return (
		<div className="screen">
			<div className="screen-head">
				<h2>Activity</h2>
				<button
					type="button"
					className="icon-button"
					aria-label="Reload activity"
					onClick={() => {
						setSpin((value) => value + 1)
						onRefresh()
					}}
				>
					<Icon
						key={spin}
						name="refresh"
						size={18}
						className={spin ? 'refresh-spin' : undefined}
					/>
				</button>
			</div>
			<p className="lede">Pending transactions appear above confirmed ones.</p>
			<ActivityRows activity={activity} address={address} />
			{data && data.rows.length > 0 ? (
				<div className="activity-footer">
					<p className="activity-count">
						{data.total > 0
							? `Page ${data.page} of ${data.totalPages} (${data.total} transactions)`
							: 'No confirmed transactions yet'}
					</p>
					{data.page < data.totalPages ? (
						<button
							type="button"
							className="btn btn-soft"
							aria-label="Load more activity"
							disabled={loadingMore}
							onClick={onLoadMore}
						>
							{loadingMore ? 'Loading more...' : 'Load more'}
						</button>
					) : null}
					{loadMoreError ? (
						<p className="field-error" role="alert">
							{loadMoreError}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	)
}

export const SettingsScreen = ({
	config,
	address,
	publicKey,
	onSave,
	onLock,
	onWipe,
	onRevealSecret,
}: {
	config: RpcConfig
	address: string
	publicKey: string
	onSave: (next: RpcConfig) => Promise<string | undefined>
	onLock: () => void
	onWipe: () => void
	onRevealSecret: (
		passphrase: string,
		kind: 'mnemonic' | 'privateKey',
	) => Promise<string>
}) => {
	const [form, setForm] = useState(config)
	const [message, setMessage] = useState<string>()
	const [busy, setBusy] = useState(false)
	const [explorer, setExplorer] = useState(getExplorerUrl)
	const [explorerMessage, setExplorerMessage] = useState<string>()

	useEffect(() => setForm(config), [config])

	const submit = async () => {
		setBusy(true)
		setMessage(undefined)
		try {
			setMessage(await onSave(form))
		} catch (caught) {
			setMessage(caught instanceof Error ? caught.message : String(caught))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="screen">
			<div className="screen-head">
				<h2>Settings</h2>
			</div>
			<form
				className="stack"
				onSubmit={(event) => {
					event.preventDefault()
					void submit()
				}}
			>
				<label className="field">
					<span>RPC URL</span>
					<input
						type="url"
						value={form.url}
						onChange={(event) => setForm({ ...form, url: event.target.value })}
						required
					/>
				</label>
				<div className="field-pair">
					<label className="field">
						<span>RPC user</span>
						<input
							type="text"
							value={form.user}
							onChange={(event) =>
								setForm({ ...form, user: event.target.value })
							}
							autoComplete="off"
						/>
					</label>
					<label className="field">
						<span>RPC password</span>
						<input
							type="password"
							value={form.password}
							onChange={(event) =>
								setForm({ ...form, password: event.target.value })
							}
							autoComplete="off"
						/>
					</label>
				</div>
				<button
					type="submit"
					className="btn btn-primary"
					disabled={busy}
					aria-label="Save RPC settings"
				>
					{busy ? 'Saving...' : 'Save settings'}
				</button>
				{message ? (
					<p className="field-note" role="status">
						{message}
					</p>
				) : null}
			</form>
			<form
				className="stack section"
				onSubmit={(event) => {
					event.preventDefault()
					try {
						const saved = persistExplorerUrl(explorer)
						setExplorerMessage(
							saved ? 'Explorer URL saved.' : 'Using the default explorer.',
						)
					} catch (caught) {
						setExplorerMessage(
							caught instanceof Error ? caught.message : String(caught),
						)
					}
				}}
			>
				<label className="field">
					<span>Explorer URL</span>
					<input
						type="text"
						value={explorer}
						onChange={(event) => setExplorer(event.target.value)}
						placeholder={DEFAULT_EXPLORER_URL}
					/>
				</label>
				<button
					type="submit"
					className="btn btn-secondary"
					aria-label="Save explorer URL"
				>
					Save explorer URL
				</button>
				{explorerMessage ? (
					<p className="field-note" role="status">
						{explorerMessage}
					</p>
				) : null}
			</form>
			<section className="section">
				<SecretReveal
					label="Seed phrase"
					load={(passphrase) => onRevealSecret(passphrase, 'mnemonic')}
				/>
				<SecretReveal
					label="Private key"
					load={(passphrase) => onRevealSecret(passphrase, 'privateKey')}
				/>
			</section>
			<section className="section stack">
				<button
					type="button"
					className="btn btn-secondary"
					aria-label="Lock wallet"
					onClick={onLock}
				>
					Lock wallet
				</button>
				<button
					type="button"
					className="btn btn-danger"
					aria-label="Delete wallet"
					onClick={onWipe}
				>
					Delete wallet
				</button>
			</section>
		</div>
	)
}

export const NavBar = ({
	route,
	onNavigate,
}: {
	route: 'home' | 'activity' | 'settings'
	onNavigate: (route: 'home' | 'activity' | 'settings') => void
}) => {
	const items: { key: typeof route; label: string; icon: IconName }[] = [
		{ key: 'home', label: 'Home', icon: 'home' },
		{ key: 'activity', label: 'History', icon: 'history' },
		{ key: 'settings', label: 'Settings', icon: 'settings' },
	]
	return (
		<nav className="nav-bar" aria-label="Main navigation">
			{items.map((item) => (
				<button
					type="button"
					key={item.key}
					className={`nav-item ${route === item.key ? 'is-active' : ''}`}
					aria-label={item.label}
					aria-current={route === item.key ? 'page' : undefined}
					onClick={() => onNavigate(item.key)}
				>
					<span className="nav-glyph">
						<Icon
							name={item.icon}
							size={24}
							className={item.key === 'home' ? 'home-outline' : undefined}
						/>
						{item.key === 'home' ? (
							<Icon name="homeFilled" size={24} className="home-filled" />
						) : null}
					</span>
					<span>{item.label}</span>
				</button>
			))}
		</nav>
	)
}
