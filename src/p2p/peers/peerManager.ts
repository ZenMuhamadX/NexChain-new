/**
 * Manajer peer P2P: lifecycle koneksi, handshake, keepalive, dan gateway
 * siaran untuk lapisan sync.
 *
 * Peer manager adalah pemilik SATU-SATUNYA state peer (map koneksi +
 * ban list). Transport (`../transport/server.ts`) hanya mem-frame dan
 * menyalurkan peristiwa; keputusan protokol (handshake, batas peer,
 * idle, ban) ada di sini supaya bisa diuji dengan transport palsu.
 *
 * Semua kerja asinkron dibungkus `.catch` / `try-catch` di dalam callback
 * supaya promise yang gagal tidak pernah menjadi unhandled rejection yang
 * membunuh proses node.
 */
import { loggingDebug } from 'src/logging/debug'
import { logToConsole } from 'src/logging/logging'
import { describeBindHost } from '../config.js'
import {
	buildVersionMessage,
	checkVersionMessage,
	createHandshakeState,
	isHandshakeComplete,
	type HandshakeState,
} from '../protocol/handshake.js'
import { P2P_PROTOCOL_VERSION, type P2PMessage } from '../protocol/messages.js'
import { connectOutbound, startServer } from '../transport/server.js'
import type {
	LocalChainStatus,
	OutboundHandle,
	PeerConnection,
	PeerManager,
	PeerManagerOptions,
	PeerState,
	ServerHandle,
	TransportEvents,
} from '../types.js'
import { BanList } from './banList.js'
import {
	updatePeers,
	updateBans,
	type PeerInfo,
} from 'src/core/events/peerState.js'

/**
 * Rekaman internal satu peer: `PeerState` (kontrak publik) plus state
 * handshake dan timer yang hanya dipakai di dalam modul ini.
 */
interface PeerRecord extends PeerState {
	handshake: HandshakeState
	/** Timer batas handshake — dibersihkan saat selesai atau koneksi tutup. */
	handshakeTimer?: ReturnType<typeof setTimeout>
	/** Nonce ping terakhir yang dikirim (untuk diagnosis/metrics). */
	lastPingNonce?: number
}

export const createPeerManager = (options: PeerManagerOptions): PeerManager => {
	const { config, getLocalStatus, events } = options

	/** Semua peer (siap maupun masih handshake), kunci = `connection.id`. */
	const peers = new Map<string, PeerRecord>()
	const banned = new BanList(config.banDurationMs)
	/** Dial keluar yang masih berjalan, kunci = `host:port`. */
	const outbound = new Map<string, OutboundHandle>()
	let server: ServerHandle | undefined
	let pingTimer: ReturnType<typeof setInterval> | undefined
	let reconnectTimer: ReturnType<typeof setInterval> | undefined

	/**
	 * Kunci endpoint pada peta `outbound`. Untuk dial keluar ini adalah
	 * `host:port` KONFIGURASI (`dialKey`) — BUKAN `remoteAddress`, yang sudah
	 * berupa IP hasil resolusi. Memakai `remoteAddress` membuat seed berupa
	 * hostname tersangkut: `onClose` menghapus kunci yang tak pernah ada, jadi
	 * `dialBootstrapPeers` melewatinya selamanya (reconnect mati) atau, bila
	 * kuncinya sempat lepas, mendial ulang tiap interval sampai menumpuk.
	 */
	const endpointKeyOf = (connection: PeerConnection): string =>
		connection.dialKey ?? `${connection.remoteAddress}:${connection.remotePort}`

	/** Lepas timer handshake bila masih terpasang. */
	const clearHandshakeTimer = (record: PeerRecord): void => {
		if (record.handshakeTimer === undefined) return
		clearTimeout(record.handshakeTimer)
		delete record.handshakeTimer
	}

	/**
	 * Panggil handler peristiwa konsumen tanpa meneruskan exception ke
	 * transport — handler yang melempar tidak boleh menjatuhkan koneksi
	 * atau loop timer.
	 */
	const emit = (label: string, handler: () => void): void => {
		try {
			handler()
		} catch (err) {
			logToConsole(`P2P: handler ${label} melempar: ${String(err)}`)
		}
	}

	/**
	 * Terbitkan snapshot peer netral (dibaca `nex_getPeerInfo`). Menyalin
	 * state internal — pemanggil RPC tak boleh bisa memutasi map peer.
	 */
	const publishPeerSnapshot = (): void => {
		const peerList = [...peers.values()].map((record): PeerInfo => ({
			id: record.connection.id,
			remoteAddress: record.connection.remoteAddress,
			remotePort: record.connection.remotePort,
			inbound: record.connection.inbound,
			handshaked: record.handshaked,
			connectedAt: record.connectedAt,
			lastSeenAt: record.lastSeenAt,
			status: record.status
				? {
						chainId: record.status.chainId,
						genesisHash: record.status.genesisHash,
						bestHeight: record.status.bestHeight,
						bestHash: record.status.bestHash,
						listenPort: record.status.listenPort,
					}
				: undefined,
		}))
		updatePeers(peerList, config.maxPeers)
		updateBans(banned.entries())
	}

	/** Tandai siap saat handshake lengkap; beritahu konsumen tepat sekali. */
	const maybeReady = (record: PeerRecord): void => {
		if (record.handshaked) return
		if (!isHandshakeComplete(record.handshake)) return
		clearHandshakeTimer(record)
		record.handshaked = true
		publishPeerSnapshot()
		emit('onPeerReady', () => events.onPeerReady(record))
	}

	/**
	 * Proses satu pesan masuk per tipe. `version`/`verack`/`ping`/`pong`
	 * tidak pernah diteruskan ke konsumen. Galat apa pun (termasuk dari
	 * `getLocalStatus`) ditangkap di sini supaya promise ini tidak pernah
	 * menolak.
	 */
	const handleMessage = async (
		connection: PeerConnection,
		record: PeerRecord,
		message: P2PMessage,
	): Promise<void> => {
		try {
			switch (message.type) {
				case 'version': {
					if (record.handshake.receivedVersion) {
						connection.close('version ganda')
						return
					}
					// Tandai SEBELUM await: `handleMessage` tidak diantrikan, jadi
					// `verack` yang tiba selama `getLocalStatus()` (leveldb) akan
					// melihat flag masih false dan memutus koneksi yang sehat.
					record.handshake.receivedVersion = true
					const local = await getLocalStatus()
					// Koneksi bisa saja sudah tutup selama await — jangan lanjut.
					if (peers.get(connection.id) !== record) return
					const check = checkVersionMessage(message, {
						chainId: local.chainId,
						genesisHash: local.genesisHash,
						protocolVersion: P2P_PROTOCOL_VERSION,
					})
					if (!check.ok) {
						const reason = check.reason ?? 'version tidak valid'
						// Pelanggaran identitas jaringan layak di-ban, bukan
						// sekadar diputus — biar tidak dihubungi lagi.
						if (check.fatal) banned.ban(connection.remoteAddress, reason)
						connection.close(reason)
						return
					}
					const status: LocalChainStatus = {
						chainId: message.chainId,
						genesisHash: message.genesisHash,
						bestHeight: message.bestHeight,
						bestHash: message.bestHash,
					}
					if (message.listenPort !== undefined) {
						status.listenPort = message.listenPort
					}
					record.status = status
					connection.send({ type: 'verack' })
					record.handshake.sentVerack = true
					maybeReady(record)
					publishPeerSnapshot()
					return
				}
				case 'verack': {
					if (!record.handshake.receivedVersion) {
						connection.close('verack sebelum version')
						return
					}
					record.handshake.receivedVerack = true
					maybeReady(record)
					publishPeerSnapshot()
					return
				}
				case 'ping':
					// Balasan dikirim meski handshake belum selesai: tidak
					// berbahaya dan mencegah kita dianggap idle oleh peer.
					connection.send({ type: 'pong', nonce: message.nonce })
					return
				case 'pong':
					// `lastSeenAt` sudah diperbarui pemanggil; nonce diabaikan.
					publishPeerSnapshot()
					return
				default:
					if (!record.handshaked) {
						connection.close('pesan sebelum handshake selesai')
						return
					}
					emit('onPeerMessage', () => events.onPeerMessage(record, message))
					return
			}
		} catch (err) {
			logToConsole(`P2P: galat memproses pesan ${message.type}: ${String(err)}`)
			connection.close('galat memproses pesan')
		}
	}

	const transportEvents: TransportEvents = {
		onConnection: (connection, inbound) => {
			const now = Date.now()
			// Berisik per koneksi — pindah ke debug supaya konsol tenang.
			loggingDebug(
				'p2p:peerManager',
				`P2P: koneksi ${inbound ? 'masuk' : 'keluar'} ` +
					`${connection.remoteAddress}:${connection.remotePort}`,
			)
			if (banned.isBanned(connection.remoteAddress)) {
				connection.close('alamat dibanned')
				return
			}
			if (peers.size >= config.maxPeers) {
				connection.close('terlalu banyak peer')
				return
			}
			const record: PeerRecord = {
				connection,
				handshaked: false,
				connectedAt: now,
				lastSeenAt: now,
				handshake: createHandshakeState(),
			}
			const timer = setTimeout(() => {
				if (!record.handshaked) connection.close('handshake timeout')
			}, config.handshakeTimeoutMs)
			if (typeof timer.unref === 'function') timer.unref()
			record.handshakeTimer = timer
			peers.set(connection.id, record)

			// Kirim `version` lokal. State hanya disentuh bila rekaman masih
			// ada (koneksi bisa tutup selama await status).
			getLocalStatus()
				.then((status) => {
					if (peers.get(connection.id) !== record) return
					connection.send(buildVersionMessage(status, P2P_PROTOCOL_VERSION))
					record.handshake.sentVersion = true
					publishPeerSnapshot()
				})
				.catch((err: unknown) => {
					logToConsole(`P2P: gagal mengambil status lokal: ${String(err)}`)
					connection.close('gagal mengambil status lokal')
				})
			publishPeerSnapshot()
		},
		onMessage: (connection, message) => {
			const record = peers.get(connection.id)
			if (record === undefined) {
				connection.close('koneksi tidak dikenal')
				return
			}
			record.lastSeenAt = Date.now()
			publishPeerSnapshot()
			// `handleMessage` menangkap seluruh galatnya sendiri; ikat `.catch`
			// di sini sebagai jaring pengaman terakhir.
			handleMessage(connection, record, message).catch((err: unknown) => {
				logToConsole(`P2P: galat handler pesan: ${String(err)}`)
			})
		},
		onClose: (connection, reason) => {
			// Lepas kunci dial keluar bila ini koneksi outbound, bahkan bila
			// rekamannya tidak pernah terbentuk (koneksi ditolak lebih dulu).
			if (!connection.inbound) {
				outbound.delete(endpointKeyOf(connection))
			}
			const record = peers.get(connection.id)
			if (record === undefined) return
			clearHandshakeTimer(record)
			peers.delete(connection.id)
			// Putus peer bisa berulang (reconnect churn) — cukup di debug.
			loggingDebug(
				'p2p:peerManager',
				`P2P: peer ${connection.remoteAddress}:${connection.remotePort} ` +
					`tertutup (${reason})`,
			)
			emit('onPeerClosed', () => events.onPeerClosed(record, reason))
			publishPeerSnapshot()
		},
		onConnectError: (host, port, reason) => {
			// Cukup dicatat: interval reconnect akan mencoba lagi nanti.
			outbound.delete(`${host}:${port}`)
			// Gagal dial berulang tiap reconnectIntervalMs — jangan banjiri konsol.
			loggingDebug(
				'p2p:peerManager',
				`P2P: gagal terhubung ke ${host}:${port} (${reason})`,
			)
		},
	}

	const send = (peerId: string, message: P2PMessage): void => {
		peers.get(peerId)?.connection.send(message)
	}

	const broadcast = (message: P2PMessage, exceptPeerId?: string): number => {
		let count = 0
		for (const record of peers.values()) {
			if (!record.handshaked) continue
			if (record.connection.id === exceptPeerId) continue
			record.connection.send(message)
			count++
		}
		return count
	}

	const readyPeers = (): PeerState[] =>
		[...peers.values()].filter((record) => record.handshaked)

	const ban = (remoteAddress: string, reason: string): void => {
		banned.ban(remoteAddress, reason)
		// Salin dulu: `close` bisa memicu `onClose` yang memutasi `peers`.
		for (const record of [...peers.values()]) {
			if (record.connection.remoteAddress !== remoteAddress) continue
			record.connection.close('dibanned: ' + reason)
		}
		publishPeerSnapshot()
	}

	const isBanned = (remoteAddress: string): boolean =>
		banned.isBanned(remoteAddress)

	const list = (): PeerState[] => [...peers.values()]

	const get = (id: string): PeerState | undefined => peers.get(id)

	/** Keepalive: putus yang idle, kirim ping sisanya. */
	const pingTick = (): void => {
		const now = Date.now()
		for (const record of [...peers.values()]) {
			if (now - record.lastSeenAt > config.idleTimeoutMs) {
				record.connection.close('idle')
				continue
			}
			const nonce = Date.now()
			record.lastPingNonce = nonce
			record.connection.send({ type: 'ping', nonce })
		}
		publishPeerSnapshot()
	}

	/**
	 * Dial semua bootstrap peer yang layak: tidak dibanned, belum punya
	 * koneksi, dan belum ada dial keluar berjalan. Pencocokan memakai
	 * `endpointKeyOf` — endpoint KONFIGURASI, jadi seed berupa hostname
	 * (`peer.example.com`) tetap dikenali walau `remoteAddress`-nya IP.
	 */
	const dialBootstrapPeers = (): void => {
		if (peers.size >= config.maxPeers) return
		for (const endpoint of config.peers) {
			const key = `${endpoint.host}:${endpoint.port}`
			if (banned.isBanned(endpoint.host)) continue
			if (outbound.has(key)) continue
			const connected = [...peers.values()].some(
				(record) => endpointKeyOf(record.connection) === key,
			)
			if (connected) continue
			const handle = connectOutbound(
				{
					host: endpoint.host,
					port: endpoint.port,
					maxMessageBytes: config.maxMessageBytes,
				},
				transportEvents,
			)
			outbound.set(key, handle)
		}
	}

	const start = async (): Promise<void> => {
		const listener = startServer(
			{
				bindHost: config.bindHost,
				port: config.port,
				maxMessageBytes: config.maxMessageBytes,
			},
			transportEvents,
		)
		server = listener
		logToConsole(
			`P2P: listener aktif di ${describeBindHost(config.bindHost)}:${listener.port} ` +
				`(peer bootstrap: ${config.peers.length})`,
		)
		// Dial awal segera; interval reconnect mengulang yang gagal nanti.
		dialBootstrapPeers()
		pingTimer = setInterval(pingTick, config.pingIntervalMs)
		reconnectTimer = setInterval(dialBootstrapPeers, config.reconnectIntervalMs)
		if (typeof pingTimer.unref === 'function') pingTimer.unref()
		if (typeof reconnectTimer.unref === 'function') reconnectTimer.unref()
		publishPeerSnapshot()
	}

	const stop = (): void => {
		if (pingTimer !== undefined) clearInterval(pingTimer)
		if (reconnectTimer !== undefined) clearInterval(reconnectTimer)
		pingTimer = undefined
		reconnectTimer = undefined

		for (const handle of outbound.values()) {
			try {
				handle.cancel()
			} catch (err) {
				logToConsole(`P2P: gagal membatalkan dial keluar: ${String(err)}`)
			}
		}
		outbound.clear()

		for (const record of [...peers.values()]) {
			clearHandshakeTimer(record)
			record.connection.close('node berhenti')
		}
		peers.clear()

		server?.stop()
		server = undefined
		publishPeerSnapshot()
	}

	return {
		start,
		stop,
		list,
		get,
		ban,
		isBanned,
		send,
		broadcast,
		readyPeers,
	}
}
