/**
 * Orkestrator P2P: merangkai peer manager + sync manager + jembatan bus core.
 *
 * Inilah SATU-SATUNYA tempat lapisan P2P disusun. `apps/node/server.ts` cukup
 * memanggil `startP2P()` setelah genesis terverifikasi. Seluruh modul di
 * bawahnya (transport, peers, sync, validation) tidak saling tahu-menahu
 * selain lewat kontrak tipe di `types.ts`, supaya bisa diuji dan diganti
 * terpisah.
 *
 * Default AMAN: bila `NEX_P2P_ENABLED` tidak truthy, `startP2P()` mengembalikan
 * `undefined` dan node berjalan persis seperti sebelumnya (tanpa port P2P).
 */
import { loadP2PConfig, type P2PConfig } from './config.js'
import { getLocalChainStatus } from './chain.js'
import { createPeerManager } from './peers/peerManager.js'
import { createSyncManager } from './sync/syncManager.js'
import { connectBlock } from './validation/connectBlock.js'
import { isBroadcastSuppressed } from './broadcastGate.js'
import { isTxHash } from 'src/core/encoding/rlp/txHash'
import { subscribeBlocks, subscribeTxs } from 'src/core/events/nodeEvents'
import { logToConsole } from 'src/logging/logging'
import type { LocalChainStatus, PeerManager, SyncManager } from './types.js'

/** Handle node P2P yang sedang berjalan. */
export interface P2PNode {
	readonly manager: PeerManager
	readonly sync: SyncManager
	stop(): void
}

const isLoopbackHost = (host: string): boolean =>
	host === '127.0.0.1' ||
	host === '::1' ||
	host === 'localhost' ||
	host.startsWith('127.')

/**
 * Nyalakan lapisan P2P. Mengembalikan `undefined` bila P2P dimatikan.
 *
 * Panggil SETELAH genesis ada & terverifikasi — peer manager langsung
 * mengirim `version` yang memuat `bestHeight`/`bestHash` dari state lokal.
 */
export const startP2P = async (
	config: P2PConfig = loadP2PConfig(),
): Promise<P2PNode | undefined> => {
	if (!config.enabled) return undefined

	if (!isLoopbackHost(config.bindHost)) {
		console.warn(
			`PERINGATAN KEAMANAN: P2P bind ke ${config.bindHost} (non-loopback). ` +
				`P2P TIDAK punya autentikasi — siapa pun yang menjangkau port ini ` +
				`bisa mengirim blok/transaksi. Batasi lewat firewall.`,
		)
	}

	const getLocalStatus = (): Promise<LocalChainStatus> =>
		getLocalChainStatus(config.port)

	// Holder supaya callback peer (dipanggil belakangan) tetap bisa merujuk
	// sync manager sementara keduanya saling membutuhkan saat dibangun.
	const syncHolder: { current?: SyncManager } = {}

	const manager = createPeerManager({
		config,
		getLocalStatus,
		events: {
			onPeerReady: (peer) => {
				const status = peer.status
				logToConsole(
					`P2P: peer siap ${peer.connection.remoteAddress}:${peer.connection.remotePort}` +
						(status ? ` (height ${status.bestHeight})` : ''),
				)
				syncHolder.current?.onPeerReady(peer)
			},
			onPeerMessage: (peer, message) => {
				syncHolder.current?.onPeerMessage(peer, message)
			},
			onPeerClosed: (peer, reason) => {
				logToConsole(
					`P2P: peer putus ${peer.connection.remoteAddress}:${peer.connection.remotePort} (${reason})`,
				)
				syncHolder.current?.onPeerClosed(peer)
			},
		},
	})

	const sync = createSyncManager({
		config,
		gateway: manager,
		getLocalStatus,
		connectBlock,
	})
	syncHolder.current = sync

	// Jembatan bus core → jaringan. Core hanya "menerbitkan"; di sini kita
	// memutuskan untuk menyiarkannya. Item yang berasal DARI peer ditandai
	// lewat broadcastGate (sync manager yang menyiarkan sendiri, dengan
	// pengecualian pengirim) sehingga tidak dipantulkan kembali.
	const unsubscribeBlocks = subscribeBlocks((block) => {
		if (isBroadcastSuppressed()) return
		const hash = block?.block?.header?.hash
		if (typeof hash === 'string' && hash.length === 64) sync.announceBlock(hash)
	})
	const unsubscribeTxs = subscribeTxs((tx) => {
		if (isBroadcastSuppressed()) return
		// `txHash` berbentuk `TxC` + 64 hex (67 karakter) — BUKAN 64 hex.
		// Memakai `isTxHash` di sini adalah inti perbaikan relay tx: pemeriksaan
		// panjang 64 membuat `announceTx` tidak pernah dipanggil.
		if (isTxHash(tx.txHash)) {
			sync.announceTx(tx.txHash)
		}
	})

	sync.start()
	await manager.start()

	logToConsole(
		`P2P aktif di ${config.bindHost}:${config.port} ` +
			`(maks ${config.maxPeers} peer, bootstrap ${config.peers.length} entri)`,
	)

	let stopped = false
	return {
		manager,
		sync,
		stop: () => {
			if (stopped) return
			stopped = true
			unsubscribeBlocks()
			unsubscribeTxs()
			sync.stop()
			manager.stop()
		},
	}
}
