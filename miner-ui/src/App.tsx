import { useState } from 'react'
import { Miner } from '@/screens/Miner'
import { Settings } from '@/screens/Settings'
import { getRpcUrl } from '@/lib/rpcUrl'

export const App = () => {
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [rpcUrl, setRpcUrl] = useState(() => getRpcUrl())

	return (
		<div className="app">
			<header className="topbar">
				<div className="brand">
					<span className="brand-mark" aria-hidden="true" />
					<div>
						<h1>NexChain Miner</h1>
						<p>Miner eksternal · tanpa seed atau private key</p>
					</div>
				</div>
				<button
					type="button"
					className="btn btn-ghost"
					onClick={() => setSettingsOpen(true)}
				>
					Pengaturan
				</button>
			</header>

			<Miner
				rpcUrl={rpcUrl}
				onOpenSettings={() => setSettingsOpen(true)}
			/>

			<footer className="footer">
				<p>
					Blok ditandatangani node saat submit lolos; hadiah dikredit ke
					alamat yang Anda masukkan. Node memverifikasi ulang setiap
					solusi (hash + difficulty + kesegaran tip) — miner hanya
					mencari nonce dan tidak dapat memanipulasi rantai.
				</p>
			</footer>

			{settingsOpen ? (
				<Settings
					current={rpcUrl}
					onClose={() => setSettingsOpen(false)}
					onSaved={(url) => {
						setRpcUrl(url)
						setSettingsOpen(false)
					}}
				/>
			) : null}
		</div>
	)
}
