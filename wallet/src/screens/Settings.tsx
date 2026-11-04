import { useState } from 'react'
import {
	persistRpcUrl,
	getRpcUrl,
	testRpcUrl,
	getRpcCredentials,
	persistRpcCredentials,
} from '../lib/rpcUrl'
import { getExplorerUrl, persistExplorerUrl } from '../lib/explorerUrl'
import { errorMessage } from '../lib/format'
import { getTheme, setTheme } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { usePlatform } from '../hooks/usePlatform'
import type { InstallHint, PersistenceState } from '../lib/platform'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'

interface SettingsProps {
	onLock: () => void
	onWipe: () => void | Promise<void>
	onBack: () => void
	mnemonic?: string
}

/** Kalimat status pemasangan menurut shell yang menjalankan wallet. */
const installHintText: Record<Exclude<InstallHint, 'prompt'>, string> = {
	installed: 'Wallet sudah berjalan sebagai aplikasi terpasang.',
	ios: 'Di iPhone/iPad: buka lewat Safari, tekan Bagikan, lalu Tambah ke Layar Utama.',
	menu: 'Buka menu browser, lalu pilih "Instal aplikasi" atau "Tambahkan ke layar utama".',
	unsupported: '',
}

const persistenceText: Record<PersistenceState, string> = {
	unknown: 'Memeriksa…',
	persisted: 'Persisten — browser tidak akan membuang data ini tanpa izin.',
	'best-effort':
		'Best-effort — browser dapat membuang data bila ruang menipis.',
	unsupported: 'Tidak didukung perangkat ini.',
}

export const Settings = ({
	onLock,
	onWipe,
	onBack,
	mnemonic,
}: SettingsProps): React.JSX.Element => {
	const [rpcUrl, setRpcUrl] = useState(getRpcUrl())
	const [theme, setThemeState] = useState<Theme>(getTheme)
	const [rpcUser, setRpcUser] = useState(getRpcCredentials().user)
	const [rpcPassword, setRpcPassword] = useState(getRpcCredentials().password)
	const [explorerUrl, setExplorerUrl] = useState(getExplorerUrl())
	const [rpcMessage, setRpcMessage] = useState('')
	const [rpcError, setRpcError] = useState('')
	const [explorerMessage, setExplorerMessage] = useState('')
	const [explorerError, setExplorerError] = useState('')
	const [testingRpc, setTestingRpc] = useState(false)
	const [showMnemonic, setShowMnemonic] = useState(false)
	const [revealPromptOpen, setRevealPromptOpen] = useState(false)
	const [wipeOpen, setWipeOpen] = useState(false)
	const [wipeAcknowledged, setWipeAcknowledged] = useState(false)
	const [wipeBusy, setWipeBusy] = useState(false)
	const [installBusy, setInstallBusy] = useState(false)
	const platform = usePlatform()

	const saveRpc = (): void => {
		try {
			persistRpcUrl(rpcUrl)
			persistRpcCredentials(rpcUser, rpcPassword)
			setRpcMessage('URL RPC tersimpan; kredensial berlaku untuk sesi ini.')
			setRpcError('')
		} catch (error) {
			setRpcError(errorMessage(error))
			setRpcMessage('')
		}
	}

	const checkRpc = async (): Promise<void> => {
		setTestingRpc(true)
		setRpcMessage('')
		setRpcError('')
		const result = await testRpcUrl(rpcUrl)
		if (result.ok) setRpcMessage(`Terhubung · Chain ID ${result.chainId}`)
		else setRpcError(result.error ?? 'Tidak dapat terhubung ke node ini.')
		setTestingRpc(false)
	}

	const saveExplorer = (): void => {
		try {
			persistExplorerUrl(explorerUrl)
			setExplorerUrl(getExplorerUrl())
			setExplorerMessage(
				explorerUrl.trim()
					? 'URL Explorer tersimpan.'
					: 'Link Explorer dikembalikan ke explorer publik default.',
			)
			setExplorerError('')
		} catch (error) {
			setExplorerError(errorMessage(error))
			setExplorerMessage('')
		}
	}

	const confirmWipe = async (): Promise<void> => {
		setWipeBusy(true)
		try {
			await onWipe()
			setWipeOpen(false)
		} catch (error) {
			setExplorerError(errorMessage(error))
		} finally {
			setWipeBusy(false)
		}
	}

	const startInstall = async (): Promise<void> => {
		setInstallBusy(true)
		try {
			await platform.requestInstall()
		} finally {
			setInstallBusy(false)
		}
	}

	const chooseTheme = (next: Theme): void => {
		setTheme(next)
		setThemeState(next)
	}

	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<p className="eyebrow">PREFERENSI & KEAMANAN</p>
					<h1>Pengaturan</h1>
					<p>Kelola tampilan, koneksi node, dan lindungi wallet lokal ini.</p>
				</div>
				<button
					type="button"
					className="button button--secondary"
					onClick={onBack}
				>
					<Icon name="arrowLeft" size={15} aria-hidden="true" /> Kembali
				</button>
			</div>

			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon">
							<Icon name="eye" size={17} aria-hidden="true" />
						</span>
						<div>
							<h2>Tampilan</h2>
							<p>Ikuti tema perangkat atau pilih sendiri.</p>
						</div>
					</div>
					<div className="segmented" role="group" aria-label="Tema tampilan">
						{(['terang', 'gelap', 'sistem'] as const).map((value) => (
							<button
								key={value}
								type="button"
								className={`segmented__item ${theme === value ? 'segmented__item--active' : ''}`}
								onClick={() => chooseTheme(value)}
								aria-pressed={theme === value}
							>
								{value === 'terang'
									? 'Terang'
									: value === 'gelap'
										? 'Gelap'
										: 'Sistem'}
							</button>
						))}
					</div>
				</div>
			</section>

			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon">
							<Icon name="diamond" size={17} aria-hidden="true" />
						</span>
						<div>
							<h2>Koneksi node</h2>
							<p>Sumber data wallet dan saldo.</p>
						</div>
					</div>
					<div className="field">
						<label className="label" htmlFor="rpc">
							URL JSON-RPC
						</label>
						<div className="input-with-action">
							<input
								id="rpc"
								className="input mono"
								value={rpcUrl}
								onChange={(event) => setRpcUrl(event.target.value)}
								placeholder="https://node1.zuns.my.id/rpc"
							/>
							<button
								type="button"
								className="button button--secondary"
								onClick={() => void checkRpc()}
								disabled={testingRpc}
							>
								{testingRpc ? 'Menguji…' : 'Uji'}
							</button>
							<button
								type="button"
								className="button button--primary"
								onClick={saveRpc}
							>
								Simpan
							</button>
						</div>
						{rpcMessage ? <Notice variant="ok">{rpcMessage}</Notice> : null}
						{rpcError ? <Notice variant="error">{rpcError}</Notice> : null}
					</div>

					<div className="field">
						<label className="label" htmlFor="rpcUser">
							RPC Username
						</label>
						<input
							id="rpcUser"
							className="input mono"
							value={rpcUser}
							onChange={(event) => setRpcUser(event.target.value)}
							placeholder="(opsional)"
							autoComplete="off"
							spellCheck={false}
						/>
						<p className="input-hint">
							Dipakai untuk method tulis (kirim transaksi) bila node menyetel
							RPC_USER/RPC_PASSWORD. Kosongkan untuk node lokal tanpa auth —
							hanya disimpan selama sesi ini, jadi ketik ulang setelah wallet
							ditutup.
						</p>
					</div>

					<div className="field">
						<label className="label" htmlFor="rpcPassword">
							RPC Password
						</label>
						<input
							id="rpcPassword"
							type="password"
							className="input mono"
							value={rpcPassword}
							onChange={(event) => setRpcPassword(event.target.value)}
							placeholder="(opsional)"
							autoComplete="off"
						/>
					</div>
				</div>

				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon">
							<Icon name="arrowUpRight" size={17} aria-hidden="true" />
						</span>
						<div>
							<h2>Koneksi Explorer</h2>
							<p>Dipakai untuk melacak hash transaksi terkonfirmasi.</p>
						</div>
					</div>
					<div className="field">
						<label className="label" htmlFor="explorer">
							Base URL Explorer
						</label>
						<div className="input-with-action">
							<input
								id="explorer"
								className="input mono"
								value={explorerUrl}
								onChange={(event) => setExplorerUrl(event.target.value)}
								placeholder="https://explorer.zuns.my.id"
							/>
							<button
								type="button"
								className="button button--primary"
								onClick={saveExplorer}
							>
								Simpan
							</button>
						</div>
						<p className="input-hint">
							Kosongkan untuk kembali ke explorer publik default
							(explorer.zuns.my.id).
						</p>
						{explorerMessage ? (
							<Notice variant="ok">{explorerMessage}</Notice>
						) : null}
						{explorerError ? (
							<Notice variant="error">{explorerError}</Notice>
						) : null}
					</div>
				</div>
			</section>

			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon">
							<Icon name="lock" size={17} aria-hidden="true" />
						</span>
						<div>
							<h2>Keamanan wallet</h2>
							<p>Visibilitas frasa pemulihan dan kontrol sesi.</p>
						</div>
					</div>
					{mnemonic ? (
						<div className="security-reveal">
							<div className="security-reveal__heading">
								<span className="label">Frasa pemulihan</span>
								{showMnemonic ? (
									<CopyButton
										text={mnemonic}
										ariaLabel="Salin frasa pemulihan"
										variant="secondary"
									/>
								) : null}
							</div>
							<button
								type="button"
								className="button button--secondary"
								onClick={() => {
									if (showMnemonic) setShowMnemonic(false)
									else setRevealPromptOpen(true)
								}}
							>
								<Icon
									name={showMnemonic ? 'eyeOff' : 'eye'}
									size={15}
									aria-hidden="true"
								/>
								{showMnemonic ? 'Sembunyikan frasa' : 'Tampilkan frasa'}
							</button>
							{showMnemonic ? (
								<div className="mnemonic-reveal">
									<code>{mnemonic}</code>
									<p>
										Jangan pernah membagikan frasa ini. Dukungan NexChain tidak
										akan pernah memintanya.
									</p>
								</div>
							) : null}
						</div>
					) : null}
					<button
						type="button"
						className="button button--secondary"
						onClick={onLock}
					>
						<Icon name="lock" size={15} aria-hidden="true" /> Kunci wallet
						sekarang
					</button>
				</div>
			</section>

			{/*
				Kartu ini HANYA dirender bila shell memasang jembatan platform
				(`supported`). Shell dev dan desktop tidak memasangnya, jadi kartu
				ini hilang tanpa satu pun cabang platform di layar lain.
			*/}
			{platform.supported ? (
				<section className="card settings-card">
					<div className="settings-section">
						<div className="settings-section__heading">
							<span className="settings-icon">
								<Icon name="download" size={17} aria-hidden="true" />
							</span>
							<div>
								<h2>Aplikasi</h2>
								<p>Status pemasangan dan penyimpanan di perangkat ini.</p>
							</div>
						</div>

						<div className="app-rows">
							<div className="app-row">
								<div>
									<strong>Mode</strong>
									<span>
										{platform.standalone ? 'Aplikasi terpasang' : 'Tab browser'}
									</span>
								</div>
								<span className="app-row__value mono">
									{platform.version ? `v${platform.version}` : 'dev'}
								</span>
							</div>

							<div className="app-row">
								<div>
									<strong>Penyimpanan</strong>
									<span>{persistenceText[platform.persistence]}</span>
								</div>
								{platform.persistence === 'best-effort' ? (
									<button
										type="button"
										className="button button--secondary button--sm"
										onClick={() => void platform.requestPersistence()}
									>
										Minta persisten
									</button>
								) : null}
							</div>
						</div>

						{platform.installHint === 'prompt' ? (
							<button
								type="button"
								className="button button--primary"
								onClick={() => void startInstall()}
								disabled={installBusy}
							>
								<Icon name="download" size={15} aria-hidden="true" />
								{installBusy ? 'Membuka dialog…' : 'Pasang aplikasi'}
							</button>
						) : platform.installHint === 'unsupported' ? null : (
							<p className="input-hint">
								{installHintText[platform.installHint]}
							</p>
						)}

						{!platform.secure && !platform.standalone ? (
							<Notice variant="error">
								Pemasangan hanya bekerja pada alamat HTTPS atau localhost. Lewat
								alamat IP dan http, browser mematikan service worker tanpa
								peringatan.
							</Notice>
						) : null}

						{platform.installHint === 'ios' ? (
							<p className="input-hint">
								Frasa pemulihan tetap satu-satunya cadangan: iOS bisa menghapus
								data situs saat penyimpanan menipis.
							</p>
						) : null}
					</div>
				</section>
			) : null}

			<section className="card danger-zone">
				<div className="settings-section__heading">
					<span className="settings-icon settings-icon--danger">
						<Icon name="trash" size={17} aria-hidden="true" />
					</span>
					<div>
						<h2>Zona berbahaya</h2>
						<p>Tindakan permanen untuk browser ini.</p>
					</div>
				</div>
				<div className="danger-row">
					<div>
						<strong>Hapus wallet lokal</strong>
						<span>
							Menghapus vault terenkripsi dari perangkat ini. Tindakan ini tidak
							dapat dibatalkan.
						</span>
					</div>
					<button
						type="button"
						className="button button--danger"
						onClick={() => setWipeOpen(true)}
					>
						<Icon name="trash" size={15} aria-hidden="true" /> Hapus wallet
					</button>
				</div>
			</section>

			<Modal
				open={revealPromptOpen}
				onClose={() => setRevealPromptOpen(false)}
				title="Tampilkan frasa pemulihan?"
				eyebrow="KONFIRMASI TINDAKAN"
				confirmText="TAMPILKAN"
				confirmLabel="Tampilkan frasa"
				onConfirm={() => {
					setShowMnemonic(true)
					setRevealPromptOpen(false)
				}}
			>
				<p>
					Pastikan tidak ada orang lain yang melihat layar ini. Siapa pun yang
					melihat frasa ini dapat menguasai seluruh dana di wallet Anda.
				</p>
			</Modal>

			<Modal
				open={wipeOpen}
				onClose={() => {
					if (wipeBusy) return
					setWipeOpen(false)
					setWipeAcknowledged(false)
				}}
				title="Hapus wallet ini?"
				eyebrow="KONFIRMASI TINDAKAN"
				variant="danger"
				confirmText="HAPUS"
				confirmLabel="Hapus permanen"
				confirmLoading={wipeBusy}
				onConfirm={wipeAcknowledged ? () => void confirmWipe() : undefined}
			>
				<div className="field">
					<p>
						Ini menghapus vault terenkripsi dari browser ini. Tanpa frasa
						pemulihan cadangan, dana dalam wallet ini tidak dapat dipulihkan.
					</p>
					<label
						className={`check-card ${wipeAcknowledged ? 'check-card--checked' : ''}`}
					>
						<input
							type="checkbox"
							checked={wipeAcknowledged}
							onChange={(event) => setWipeAcknowledged(event.target.checked)}
						/>
						<span>
							<strong>Saya punya frasa pemulihan</strong>
							<small>
								Saya mengerti wallet ini tidak bisa dipulihkan tanpa frasa itu.
							</small>
						</span>
					</label>
				</div>
			</Modal>
		</div>
	)
}
