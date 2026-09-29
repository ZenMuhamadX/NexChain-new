import { useState } from 'react'
import { persistRpcUrl, getRpcUrl, testRpcUrl } from '../lib/rpcUrl'
import { getExplorerUrl, persistExplorerUrl } from '../lib/explorerUrl'
import { errorMessage } from '../lib/format'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { AddressText } from '../ui/AddressText'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'

interface SettingsProps {
	address: string
	onLock: () => void
	onWipe: () => void | Promise<void>
	mnemonic?: string
	chainId?: number
	/** Disembunyikan di tab penuh — tidak ada yang bisa dibuka dari sana. */
	isPopup: boolean
}

export const Settings = ({
	address,
	onLock,
	onWipe,
	mnemonic,
	chainId,
	isPopup,
}: SettingsProps): React.JSX.Element => {
	const [rpcUrl, setRpcUrl] = useState(getRpcUrl())
	const [explorerUrl, setExplorerUrl] = useState(getExplorerUrl())
	const [rpcMessage, setRpcMessage] = useState('')
	const [rpcError, setRpcError] = useState('')
	const [explorerMessage, setExplorerMessage] = useState('')
	const [explorerError, setExplorerError] = useState('')
	const [testingRpc, setTestingRpc] = useState(false)
	const [showMnemonic, setShowMnemonic] = useState(false)
	const [wipeOpen, setWipeOpen] = useState(false)
	const [wipeBusy, setWipeBusy] = useState(false)

	const saveRpc = async (): Promise<void> => {
		try {
			await persistRpcUrl(rpcUrl)
			setRpcMessage('URL RPC tersimpan untuk extension ini.')
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

	const saveExplorer = async (): Promise<void> => {
		try {
			const normalized = await persistExplorerUrl(explorerUrl)
			setExplorerUrl(normalized)
			setExplorerMessage(
				normalized
					? 'URL Explorer tersimpan.'
					: 'Link Explorer dinonaktifkan.',
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

	return (
		<div className="page-stack">
			<div className="page-head">
				<div>
					<h1>Setelan</h1>
					<p className="page-head__sub">Koneksi node, explorer, dan keamanan.</p>
				</div>
			</div>

			{/* --- Akun --- */}
			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon" aria-hidden="true">
							<Icon name="diamond" size={16} />
						</span>
						<div>
							<h2>Akun</h2>
							<p>Alamat wallet aktif di extension ini.</p>
						</div>
					</div>
					<div className="address-panel address-panel--stack">
						<AddressText address={address} head={14} tail={10} />
					</div>
					<div className="field-actions">
						<CopyButton
							text={address}
							ariaLabel="Salin alamat wallet"
							variant="secondary"
							size={14}
						>
							Salin alamat
						</CopyButton>
						<span className="input-hint">
							{chainId !== undefined ? `Chain ${chainId}` : 'Chain —'}
						</span>
					</div>
				</div>
			</section>

			{/* --- Koneksi --- */}
			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon" aria-hidden="true">
							<Icon name="refresh" size={16} />
						</span>
						<div>
							<h2>Koneksi node</h2>
							<p>Sumber data saldo, nonce, dan riwayat.</p>
						</div>
					</div>
					<div className="field">
						<label className="label" htmlFor="rpc">
							URL JSON-RPC
						</label>
						<input
							id="rpc"
							className="input mono"
							value={rpcUrl}
							spellCheck={false}
							autoComplete="off"
							placeholder="http://localhost:8000/rpc"
							onChange={(event) => setRpcUrl(event.target.value)}
						/>
						{/* Tombol ditumpuk: "Uji" dan "Simpan" berdampingan akan
						    memotong input URL di lebar 360px. */}
						<div className="form-actions form-actions--stack">
							<button
								type="button"
								className="button button--primary"
								onClick={() => void saveRpc()}
							>
								Simpan
							</button>
							<button
								type="button"
								className="button button--secondary"
								onClick={() => void checkRpc()}
								disabled={testingRpc}
							>
								{testingRpc ? 'Menguji…' : 'Uji koneksi'}
							</button>
						</div>
						{rpcMessage ? <Notice variant="ok">{rpcMessage}</Notice> : null}
						{rpcError ? <Notice variant="error">{rpcError}</Notice> : null}
					</div>
				</div>

				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon" aria-hidden="true">
							<Icon name="arrowUpRight" size={16} />
						</span>
						<div>
							<h2>Koneksi Explorer</h2>
							<p>Dipakai untuk membuka hash transaksi di tab baru.</p>
						</div>
					</div>
					<div className="field">
						<label className="label" htmlFor="explorer">
							Base URL Explorer
						</label>
						<input
							id="explorer"
							className="input mono"
							value={explorerUrl}
							spellCheck={false}
							autoComplete="off"
							placeholder="https://explorer.example.com"
							onChange={(event) => setExplorerUrl(event.target.value)}
						/>
						<button
							type="button"
							className="button button--primary"
							onClick={() => void saveExplorer()}
						>
							Simpan
						</button>
						<p className="input-hint">
							Kosongkan untuk menonaktifkan link eksternal.
						</p>
						{explorerMessage ? <Notice variant="ok">{explorerMessage}</Notice> : null}
						{explorerError ? <Notice variant="error">{explorerError}</Notice> : null}
					</div>
				</div>
			</section>

			{/* --- Keamanan --- */}
			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon" aria-hidden="true">
							<Icon name="lock" size={16} />
						</span>
						<div>
							<h2>Keamanan wallet</h2>
							<p>Frasa pemulihan dan kontrol sesi.</p>
						</div>
					</div>

					{mnemonic ? (
						<div className="security-reveal">
							<div className="security-reveal__heading">
								<span className="label">Frasa pemulihan</span>
								<CopyButton
									text={mnemonic}
									ariaLabel="Salin frasa pemulihan"
									variant="secondary"
									size={14}
								>
									Salin
								</CopyButton>
							</div>
							<button
								type="button"
								className="button button--secondary button--sm"
								onClick={() => setShowMnemonic((value) => !value)}
								aria-pressed={showMnemonic}
							>
								<Icon
									name={showMnemonic ? 'eyeOff' : 'eye'}
									size={14}
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
						className="button button--secondary button--wide"
						onClick={onLock}
					>
						<Icon name="lock" size={15} aria-hidden="true" /> Kunci wallet sekarang
					</button>
					<p className="input-hint">
						{isPopup
							? 'Popup akan terkunci juga saat Anda menutupnya.'
							: 'Kunci manual menghapus kunci privat dari memori sesi ini.'}
					</p>
				</div>
			</section>

			{/* --- Zona berbahaya --- */}
			<section className="card settings-card danger-zone">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span
							className="settings-icon settings-icon--danger"
							aria-hidden="true"
						>
							<Icon name="trash" size={16} />
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
								Menghapus vault terenkripsi dari perangkat ini. Tidak dapat
								dibatalkan.
							</span>
						</div>
						<button
							type="button"
							className="button button--danger button--sm"
							onClick={() => setWipeOpen(true)}
						>
							Hapus
						</button>
					</div>
				</div>
			</section>

			<Modal
				open={wipeOpen}
				onClose={() => !wipeBusy && setWipeOpen(false)}
				title="Hapus wallet ini?"
				variant="danger"
				confirmText="HAPUS"
				confirmLabel="Hapus permanen"
				confirmLoading={wipeBusy}
				onConfirm={() => void confirmWipe()}
			>
				<p>
					Ini menghapus vault terenkripsi dari browser ini. Tanpa frasa pemulihan
					cadangan, dana di wallet ini tidak dapat dipulihkan.
				</p>
			</Modal>
		</div>
	)
}
