import { useState } from 'react'
import { persistRpcUrl, getRpcUrl } from '../lib/rpcUrl'
import { errorMessage, copyText } from '../lib/format'
import { Icon } from '../ui/Icon'
import type { Tab } from '../types'

interface SettingsProps {
	onLock: () => void
	onWipe: () => void
	setTab: (tab: Tab) => void
	mnemonic?: string
}

/**
 * Tab Pengaturan: ganti URL RPC (persist ke localStorage), kunci wallet,
 * dan hapus semua data (wipe IndexedDB + localStorage).
 */
export const Settings = ({ onLock, onWipe, setTab, mnemonic }: SettingsProps): React.JSX.Element => {
	const [url, setUrl] = useState(getRpcUrl())
	const [message, setMessage] = useState('')
	const [error, setError] = useState('')
	const [showMnemonic, setShowMnemonic] = useState(false)
	const [copied, setCopied] = useState(false)

	const saveUrl = (): void => {
		try {
			persistRpcUrl(url)
			setMessage('URL RPC disimpan.')
			setError('')
		} catch (e) {
			setError(errorMessage(e))
			setMessage('')
		}
	}

	const copyMnemonic = async (): Promise<void> => {
		if (!mnemonic) return
		const ok = await copyText(mnemonic)
		setCopied(ok)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<section className="card">
			<h2>Pengaturan</h2>

			<div className="group">
				<label className="label" htmlFor="rpc">URL RPC Node</label>
				<div className="input-action">
					<input id="rpc" className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8000/rpc" />
					<button onClick={saveUrl}>Simpan URL</button>
				</div>
				{message ? <p className="ok">{message}</p> : null}
				{error ? <p className="error">{error}</p> : null}
			</div>

			{mnemonic ? (
				<div className="group">
					<p className="label">Mnemonic</p>
					<div className="row">
						<button className="ghost" onClick={() => setShowMnemonic((v) => !v)}>
							<Icon name={showMnemonic ? 'eyeOff' : 'eye'} size={15} />
							{showMnemonic ? 'Sembunyikan' : 'Tampilkan'}
						</button>
						<button className="ghost" onClick={() => void copyMnemonic()}>
							<Icon name={copied ? 'check' : 'copy'} size={15} />
							{copied ? 'Tersalin' : 'Salin'}
						</button>
					</div>
					{showMnemonic ? <p className="mono mnemonic-show">{mnemonic}</p> : null}
				</div>
			) : null}

			<div className="group">
				<div className="row">
					<button className="ghost" onClick={() => { onLock(); setTab('ringkasan') }}>
						<Icon name="lock" size={15} />
						Kunci Wallet
					</button>
					<button className="danger" onClick={onWipe}>
						<Icon name="trash" size={15} />
						Hapus Wallet
					</button>
				</div>
			</div>
		</section>
	)
}
