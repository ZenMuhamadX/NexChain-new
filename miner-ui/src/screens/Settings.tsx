import { useEffect, useState } from 'react'
import { errorMessage } from '@/lib/format'
import { persistRpcUrl, testRpcUrl } from '@/lib/rpcUrl'
import type { RpcConnectionResult } from '@/lib/rpcUrl'

export const Settings = ({
	current,
	onClose,
	onSaved,
}: {
	current: string
	onClose: () => void
	onSaved: (url: string) => void
}) => {
	const [value, setValue] = useState(current)
	const [testing, setTesting] = useState(false)
	const [result, setResult] = useState<RpcConnectionResult | null>(null)

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	const handleTest = async () => {
		setTesting(true)
		setResult(await testRpcUrl(value))
		setTesting(false)
	}

	const handleSave = () => {
		try {
			const url = value.trim()
			persistRpcUrl(url)
			onSaved(url)
		} catch (error) {
			setResult({ ok: false, error: errorMessage(error) })
		}
	}

	return (
		<div className="backdrop" onClick={onClose}>
			<div
				className="modal"
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Endpoint node"
			>
				<h2>Endpoint node</h2>
				<p>
					Alamat JSON-RPC node yang akan ditambang, disimpan di browser
					ini. Catatan: halaman HTTPS tidak dapat menghubungi node
					http:// (mixed content diblokir browser) — gunakan proxy
					HTTPS atau isi <code>VITE_RPC_URL</code> saat build.
				</p>

				<input
					type="text"
					value={value}
					onChange={(event) => {
						setValue(event.target.value)
						setResult(null)
					}}
					placeholder="http://localhost:8000/rpc"
					spellCheck={false}
					autoComplete="off"
				/>

				{result ? (
					<div
						className={`notice ${result.ok ? 'notice-ok' : 'notice-err'}`}
					>
						{result.ok
							? `Terhubung — chain ID ${result.chainId}.`
							: result.error}
					</div>
				) : null}

				<div className="modal-actions">
					<button
						type="button"
						className="btn btn-ghost"
						onClick={handleTest}
						disabled={testing}
					>
						{testing ? 'Menguji…' : 'Tes koneksi'}
					</button>
					<button type="button" className="btn btn-ghost" onClick={onClose}>
						Batal
					</button>
					<button
						type="button"
						className="btn btn-primary"
						onClick={handleSave}
					>
						Simpan
					</button>
				</div>
			</div>
		</div>
	)
}
