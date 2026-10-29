import { useChain } from '../../hooks/useChainState'
import { formatNumber } from '../../lib/format'

type Tone = 'ok' | 'busy' | 'down'

/**
 * SATU-SATUNYA indikator status node di seluruh UI.
 *
 * Sebelumnya status muncul tiga kali dengan kata yang berbeda-beda:
 * header kecil ("Connected · Tip #0"), hero ("Live NexChain network"), dan
 * panel Network Overview ("● Live"). Tiga sumber, tiga kebenaran — dan
 * "Live" tetap menyala walau node sedang mengejar peer. Sekarang semuanya
 * membaca `ChainContext` yang sama dan hanya dirender di sini.
 *
 * Isi sengaja "cukup lengkap" tanpa jadi panel: status koneksi, chain id,
 * tinggi tip (atau progres catch-up saat syncing), dan jumlah peer.
 * Detail mentah (fase sync, target height) masuk `title` supaya tidak
 * memenuhi header.
 */
export function NodeStatus() {
	const { state, chainId, sync, peers, error, loading } = useChain()

	// `error` saja, BUKAN `error && !state`: `useAsync` sengaja menyimpan data
	// terakhir saat poll gagal, jadi menunggu `state` hilang berarti
	// indikator tetap bilang "Synced" padahal RPC sudah mati.
	const offline = Boolean(error)
	const syncing = sync?.syncing === true
	const forked = sync?.phase === 'forked'
	const tip = state?.currentBlockHeight

	let label: string
	let tone: Tone
	if (offline) {
		label = 'RPC offline'
		tone = 'down'
	} else if (!state) {
		label = loading ? 'Connecting…' : 'No chain data'
		tone = 'busy'
	} else if (forked) {
		label = 'Reorg'
		tone = 'busy'
	} else if (syncing) {
		label = 'Syncing'
		tone = 'busy'
	} else if (sync?.phase === 'synced' || sync?.phase === 'assumed') {
		label = 'Synced'
		tone = 'ok'
	} else {
		// `idle` = P2P tidak aktif (node tunggal/devnet). Node tetap sehat,
		// jadi jangan mengklaim "synced" — tidak ada peer untuk disusul.
		label = 'Connected'
		tone = 'ok'
	}

	const localHeight = sync?.localHeight ?? 0
	const targetHeight = sync?.targetHeight ?? 0
	const catchUp =
		syncing && targetHeight > localHeight
			? `#${formatNumber(localHeight)} → #${formatNumber(targetHeight)}`
			: undefined

	const peerText =
		peers && (peers.count > 0 || peers.maxPeers > 0)
			? peers.maxPeers > 0
				? `${formatNumber(peers.count)}/${formatNumber(peers.maxPeers)} peers`
				: `${formatNumber(peers.count)} peers`
			: undefined

	const title = offline
		? 'The configured NexChain RPC cannot be reached.'
		: [
				`Node ${label.toLowerCase()}`,
				chainId !== undefined ? `chain ${chainId}` : undefined,
				tip !== undefined ? `tip #${formatNumber(tip)}` : undefined,
				sync ? `phase ${sync.phase}` : undefined,
				peerText,
			]
				.filter(Boolean)
				.join(' · ')

	return (
		<div className={`node-status node-status-${tone}`} title={title}>
			<span className="chain-dot" aria-hidden="true" />
			<span className="node-status-label" role="status">
				{label}
			</span>
			{!offline && chainId !== undefined ? (
				<span className="node-status-meta node-status-chain">
					Chain {chainId}
				</span>
			) : null}
			{!offline && tip !== undefined && !catchUp ? (
				<span className="node-status-meta node-status-tip">
					Tip <span className="mono">#{formatNumber(tip)}</span>
				</span>
			) : null}
			{!offline && catchUp ? (
				<span className="node-status-meta node-status-tip mono">{catchUp}</span>
			) : null}
			{!offline && peerText ? (
				<span className="node-status-meta node-status-peers">{peerText}</span>
			) : null}
		</div>
	)
}
