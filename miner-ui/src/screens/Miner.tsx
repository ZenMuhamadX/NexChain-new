import { useMemo, useState } from 'react'
import { useMiner } from '@/hooks/useMiner'
import type { MinerStatus } from '@/hooks/useMiner'
import { isValidMinerAddress } from '@/lib/rpc'
import {
	formatClock,
	formatCount,
	formatDuration,
	formatHashrate,
	formatNxc,
	shortHash,
} from '@/lib/format'
import { Stat } from '@/ui/Stat'

/** Umur job di node (`JOB_TTL_MS` di src/core/consensus/jobStore.ts). */
const JOB_TTL_MS = 5 * 60 * 1000

type Tone = 'accent' | 'success' | 'warn' | 'danger' | 'muted'

const STATUS_LABEL: Record<MinerStatus, { text: string; tone: Tone }> = {
	idle: { text: 'Menganggur', tone: 'muted' },
	connecting: { text: 'Meminta job…', tone: 'accent' },
	mining: { text: 'Menambang', tone: 'accent' },
	submitting: { text: 'Mengirim solusi…', tone: 'accent' },
	retrying: { text: 'Menunggu node', tone: 'warn' },
}

const Kv = ({ k, v, title }: { k: string; v: string; title?: string }) => (
	<div className="kv-item">
		<span className="kv-key">{k}</span>
		<span className="kv-val" title={title ?? v}>
			{v}
		</span>
	</div>
)

export const Miner = ({
	rpcUrl,
	onOpenSettings,
}: {
	rpcUrl: string
	onOpenSettings: () => void
}) => {
	const miner = useMiner()
	const [addressInput, setAddressInput] = useState('')

	const { running, stopping, status, currentJob, now, ready } = miner

	const trimmed = addressInput.trim()
	const valid = isValidMinerAddress(trimmed)

	const acceptedBlocks = useMemo(
		() => miner.blocksFound.filter((block) => block.accepted).length,
		[miner.blocksFound],
	)

	const remainingMs = currentJob ? Math.max(currentJob.expiresAt - now, 0) : 0
	const remainingPct = currentJob
		? Math.min((remainingMs / JOB_TTL_MS) * 100, 100)
		: 0

	const statusInfo = STATUS_LABEL[status]
	const startDisabled = running || !valid || !ready

	return (
		<>
			<section className="card">
				<div className="card-head">
					<h2>Konfigurasi miner</h2>
					<button
						type="button"
						className="rpc-chip"
						onClick={onOpenSettings}
						title="Ubah endpoint node"
					>
						<span className="dot" data-on={miner.connected} />
						<code>{rpcUrl}</code>
					</button>
				</div>

				<label className="field-label" htmlFor="miner-address">
					Alamat penerima hadiah
				</label>
				<div className="row">
					<input
						id="miner-address"
						type="text"
						value={addressInput}
						onChange={(event) => setAddressInput(event.target.value)}
						placeholder="NxC… atau NxS… (43 karakter)"
						spellCheck={false}
						autoComplete="off"
						disabled={running}
					/>
					<button
						type="button"
						className="btn btn-primary"
						disabled={startDisabled}
						onClick={() => miner.start(trimmed)}
					>
						{running ? 'Mining berjalan' : 'Mulai mining'}
					</button>
					<button
						type="button"
						className="btn btn-danger"
						disabled={!running || stopping}
						onClick={miner.stop}
					>
						{stopping ? 'Menghentikan…' : 'Stop'}
					</button>
				</div>

				{trimmed && !valid ? (
					<p className="hint error">
						Format alamat salah — harus diawali NxC/NxS dan tepat 43
						karakter.
					</p>
				) : (
					<p className="hint">
						Mining sepenuhnya eksternal dan tanpa kunci: node menyusun
						template, UI hanya mencari nonce, lalu node memverifikasi
						ulang dan mengkredit hadiah.
					</p>
				)}

				{miner.workerError ? (
					<div className="notice notice-warn" style={{ marginTop: 12 }}>
						Worker bermasalah: {miner.workerError}
					</div>
				) : null}
			</section>

			<section className="stats">
				<Stat label="Status" value={statusInfo.text} tone={statusInfo.tone} />
				<Stat
					label="Hashrate"
					value={formatHashrate(miner.hashrate)}
					hint="job berjalan"
				/>
				<Stat label="Total hash" value={formatCount(miner.totalHashes)} />
				<Stat
					label="Blok diterima"
					value={String(acceptedBlocks)}
					tone={acceptedBlocks > 0 ? 'success' : undefined}
					hint="sesi ini"
				/>
				<Stat
					label="Saldo hadiah"
					value={formatNxc(miner.balanceNexu)}
					hint={
						miner.address
							? shortHash(miner.address, 8, 5)
							: 'alamat hadiah'
					}
				/>
				<Stat
					label="Tip jaringan"
					value={miner.tipHeight !== null ? `#${miner.tipHeight}` : '—'}
					hint={
						miner.chainId !== null
							? `chain ID ${miner.chainId}`
							: miner.connected
								? 'terhubung'
								: 'tidak terhubung'
					}
					tone={miner.connected ? undefined : 'danger'}
				/>
			</section>

			<section className="card">
				<div className="card-head">
					<h2>Job aktif</h2>
					{currentJob ? (
						<span className="meta">
							kedaluwarsa dalam {formatDuration(remainingMs)}
						</span>
					) : null}
				</div>

				{currentJob ? (
					<>
						<div className="kv">
							<Kv k="Job ID" v={currentJob.jobId} />
							<Kv k="Height" v={`#${currentJob.height}`} />
							<Kv
								k="Difficulty"
								v={`${currentJob.difficulty} bits`}
							/>
							<Kv
								k="Nonce terakhir"
								v={formatCount(miner.currentNonce)}
							/>
							<Kv
								k="Hash job ini"
								v={formatCount(miner.currentHashes)}
							/>
							<Kv
								k="Blok sebelumnya"
								v={shortHash(currentJob.previousBlockHash)}
								title={currentJob.previousBlockHash}
							/>
						</div>
						<div className="bar">
							<div
								className="bar-fill"
								data-low={remainingPct < 25}
								style={{ width: `${remainingPct}%` }}
							/>
						</div>
					</>
				) : (
					<p className="empty">
						Belum ada job aktif. Tekan “Mulai mining” untuk meminta job
						dari node.
					</p>
				)}
			</section>

			<div className="grid-2">
				<section className="card">
					<div className="card-head">
						<h2>Blok ditemukan</h2>
						<span className="meta">{acceptedBlocks} diterima</span>
					</div>
					{miner.blocksFound.length === 0 ? (
						<p className="empty">Belum ada blok pada sesi ini.</p>
					) : (
						<div className="list">
							{miner.blocksFound.map((block) => (
								<div
									className="list-row"
									key={`${block.height}-${block.nonce}-${block.at}`}
								>
									<span
										className={`badge ${block.accepted ? 'badge-success' : 'badge-warn'}`}
									>
										#{block.height}
									</span>
									<span
										className="grow mono truncate"
										title={block.hash}
									>
										{shortHash(block.hash)}
									</span>
									<span className="muted">
										{block.difficulty}b
									</span>
									<span className="muted">
										{formatDuration(block.elapsedMs)}
									</span>
									{block.accepted ? null : (
										<span
											className="badge badge-danger"
											title={block.error}
										>
											ditolak
										</span>
									)}
								</div>
							))}
						</div>
					)}
				</section>

				<section className="card">
					<div className="card-head">
						<h2>Aktivitas</h2>
						<span className="meta">{miner.log.length}</span>
					</div>
					{miner.log.length === 0 ? (
						<p className="empty">Belum ada aktivitas.</p>
					) : (
						<div className="list">
							{miner.log.map((entry) => (
								<div
									className="log-row"
									key={entry.id}
									data-level={entry.level}
								>
									<span className="log-time">
										{formatClock(entry.at)}
									</span>
									<span className="log-msg">{entry.message}</span>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</>
	)
}
