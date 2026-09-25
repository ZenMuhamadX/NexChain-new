import { useState } from 'react'
import { persistRpcUrl, getRpcUrl, testRpcUrl } from '../lib/rpcUrl'
import { getExplorerUrl, persistExplorerUrl } from '../lib/explorerUrl'
import { errorMessage } from '../lib/format'
import { Icon } from '../ui/Icon'
import { CopyButton } from '../ui/CopyButton'
import { Modal } from '../ui/Modal'
import { Notice } from '../ui/Notice'

interface SettingsProps {
	onLock: () => void
	onWipe: () => void | Promise<void>
	mnemonic?: string
}

export const Settings = ({
	onLock,
	onWipe,
	mnemonic,
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

	const saveRpc = (): void => {
		try {
			persistRpcUrl(rpcUrl)
				setRpcMessage('URL RPC tersimpan untuk browser ini.')
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
			const normalized = persistExplorerUrl(explorerUrl)
			setExplorerUrl(normalized)
			setExplorerMessage(normalized ? 'URL Explorer tersimpan.' : 'Link Explorer dikembalikan ke default development.')
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
			<div className="page-heading">
				<div>
					<p className="eyebrow">PREFERENSI & KEAMANAN</p>
					<h1>Pengaturan</h1>
					<p>Kelola koneksi node dan lindungi wallet lokal ini.</p>
				</div>
			</div>

			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon"><Icon name="diamond" size={17} aria-hidden="true" /></span>
						<div><h2>Koneksi node</h2><p>Sumber data wallet dan saldo.</p></div>
					</div>
					<div className="field">
						<label className="label" htmlFor="rpc">URL JSON-RPC</label>
						<div className="input-with-action">
							<input id="rpc" className="input mono" value={rpcUrl} onChange={(event) => setRpcUrl(event.target.value)} placeholder="http://localhost:8000/rpc" />
							<button type="button" className="button button--secondary" onClick={() => void checkRpc()} disabled={testingRpc}>{testingRpc ? 'Menguji…' : 'Uji'}</button>
							<button type="button" className="button button--primary" onClick={saveRpc}>Simpan</button>
						</div>
						{rpcMessage ? <Notice variant="ok">{rpcMessage}</Notice> : null}
						{rpcError ? <Notice variant="error">{rpcError}</Notice> : null}
					</div>
				</div>

				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon"><Icon name="arrowUpRight" size={17} aria-hidden="true" /></span>
						<div><h2>Koneksi Explorer</h2><p>Dipakai untuk melacak hash transaksi terkonfirmasi.</p></div>
					</div>
					<div className="field">
						<label className="label" htmlFor="explorer">Base URL Explorer</label>
						<div className="input-with-action">
							<input id="explorer" className="input mono" value={explorerUrl} onChange={(event) => setExplorerUrl(event.target.value)} placeholder="https://explorer.example.com" />
							<button type="button" className="button button--primary" onClick={saveExplorer}>Simpan</button>
						</div>
						<p className="input-hint">Kosongkan untuk menonaktifkan link eksternal. Development lokal memakai http://localhost:5173.</p>
						{explorerMessage ? <Notice variant="ok">{explorerMessage}</Notice> : null}
						{explorerError ? <Notice variant="error">{explorerError}</Notice> : null}
					</div>
				</div>
			</section>

			<section className="card settings-card">
				<div className="settings-section">
					<div className="settings-section__heading">
						<span className="settings-icon"><Icon name="lock" size={17} aria-hidden="true" /></span>
						<div><h2>Keamanan wallet</h2><p>Visibilitas frasa pemulihan dan kontrol sesi.</p></div>
					</div>
					{mnemonic ? (
						<div className="security-reveal">
							<div className="security-reveal__heading"><span className="label">Frasa pemulihan</span><CopyButton text={mnemonic} ariaLabel="Salin frasa pemulihan" variant="secondary" /></div>
							<button type="button" className="button button--secondary" onClick={() => setShowMnemonic((value) => !value)}>
								<Icon name={showMnemonic ? 'eyeOff' : 'eye'} size={15} aria-hidden="true" />{showMnemonic ? 'Sembunyikan frasa' : 'Tampilkan frasa'}
							</button>
							{showMnemonic ? <div className="mnemonic-reveal"><code>{mnemonic}</code><p>Jangan pernah membagikan frasa ini. Dukungan NexChain tidak akan pernah memintanya.</p></div> : null}
						</div>
					) : null}
					<button type="button" className="button button--secondary" onClick={onLock}><Icon name="lock" size={15} aria-hidden="true" /> Kunci wallet sekarang</button>
				</div>
			</section>

			<section className="card danger-zone">
				<div className="settings-section__heading">
					<span className="settings-icon settings-icon--danger"><Icon name="trash" size={17} aria-hidden="true" /></span>
					<div><h2>Zona berbahaya</h2><p>Tindakan permanen untuk browser ini.</p></div>
				</div>
				<div className="danger-row">
					<div><strong>Hapus wallet lokal</strong><span>Menghapus vault terenkripsi dari perangkat ini. Tindakan ini tidak dapat dibatalkan.</span></div>
					<button type="button" className="button button--danger" onClick={() => setWipeOpen(true)}><Icon name="trash" size={15} aria-hidden="true" /> Hapus wallet</button>
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
				<p>Ini menghapus vault terenkripsi dari browser ini. Tanpa frasa pemulihan cadangan, dana dalam wallet ini tidak dapat dipulihkan.</p>
			</Modal>
		</div>
	)
}
