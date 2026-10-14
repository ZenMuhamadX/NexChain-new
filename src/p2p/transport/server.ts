/// <reference types="bun-types" />
/**
 * Transport TCP P2P: listener masuk (`Bun.listen`) dan koneksi keluar
 * (`Bun.connect`).
 *
 * Modul ini hanya mengurus membuka dan menutup socket Bun — semua logika
 * framing dan siklus hidup `PeerConnection` ada di `./connection.ts`.
 * Peristiwa diteruskan apa adanya ke `TransportEvents`:
 *
 * - `startServer` — setiap koneksi masuk diumumkan lewat `onConnection`,
 *   pesan lewat `onMessage`, penutupan lewat `onClose`.
 * - `connectOutbound` — hasilnya muncul BELAKANGAN lewat `onConnection`
 *   (fungsi ini tidak menunggu); kegagalan sambung lewat `onConnectError`.
 *
 * Prinsip keselamatan: tidak ada error transport yang boleh menggugurkan
 * proses. Semua kegagalan diarahkan ke penutupan koneksi + laporan peristiwa.
 */
import type {
	ConnectOptions,
	OutboundHandle,
	ServerHandle,
	ServerOptions,
	TransportEvents,
} from '../types.js'
import { TcpConnection } from './connection.js'

/** Penghitung id koneksi — unik selama proses berjalan. */
let connectionCounter = 0

/** Id koneksi baru: `p2p-1`, `p2p-2`, … */
const nextConnectionId = (): string => `p2p-${++connectionCounter}`

/** Ambil pesan singkat dari nilai error apa pun. */
const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

/** Tutup socket paksa tanpa meneruskan error ke handler Bun. */
const terminateQuietly = (socket: Bun.Socket<undefined>): void => {
	try {
		socket.terminate()
	} catch {
		// socket sudah mati — abaikan
	}
}

/**
 * Buka listener TCP inbound.
 *
 * Melempar pesan Indonesia yang jelas bila port gagal di-bind (port terpakai,
 * hak istimewa, dsb.) — kegagalan bind adalah kesalahan startup, bukan
 * kesalahan transport per peer.
 */
export const startServer = (
	options: ServerOptions,
	events: TransportEvents,
): ServerHandle => {
	// Registry koneksi masuk: socket → pembungkusnya.
	const connections = new Map<Bun.Socket<undefined>, TcpConnection>()

	try {
		const listener = Bun.listen<undefined>({
			hostname: options.bindHost,
			port: options.port,
			socket: {
				open(socket) {
					try {
						const connection = new TcpConnection(socket, {
							id: nextConnectionId(),
							inbound: true,
							maxMessageBytes: options.maxMessageBytes,
							events,
						})
						connections.set(socket, connection)
						events.onConnection(connection, true)
					} catch (error) {
						// Socket mungkin sudah hilang saat `open` dipanggil, atau
						// pemilik melempar — tutup koneksi, jangan gugurkan proses.
						const reason = describeError(error)
						console.error(`P2P: koneksi masuk gagal ditangani: ${reason}`)
						const failed = connections.get(socket)
						if (failed) {
							connections.delete(socket)
							failed.handleSocketClose('gagal ditangani: ' + reason)
						}
						terminateQuietly(socket)
					}
				},
				data(socket, chunk) {
					const connection = connections.get(socket)
					if (!connection) return
					// Buffer adalah Uint8Array; disalin dulu supaya tidak menahan
					// buffer pool Bun lebih lama dari yang diperlukan decoder.
					connection.feed(new Uint8Array(chunk))
				},
				close(socket, error) {
					const connection = connections.get(socket)
					if (!connection) return
					connection.handleSocketClose(
						error ? 'error: ' + error.message : 'ditutup peer',
					)
					connections.delete(socket)
				},
				error(socket, error) {
					const connection = connections.get(socket)
					if (!connection) return
					connection.handleSocketClose('error: ' + error.message)
					connections.delete(socket)
				},
			},
		})

		return {
			port: listener.port,
			stop: () => {
				// Beri tahu pemilik dulu (onClose tetap hanya sekali), lalu
				// hentikan listener beserta koneksi yang masih aktif.
				for (const connection of connections.values()) {
					connection.handleSocketClose('server dihentikan')
				}
				connections.clear()
				listener.stop(true)
			},
		}
	} catch (error) {
		throw new Error(
			`P2P: gagal listen di ${options.bindHost}:${options.port} — ` +
				describeError(error),
			{ cause: error },
		)
	}
}

/**
 * Buka satu koneksi keluar ke peer.
 *
 * Mengembalikan handle SEGERA tanpa menunggu sambungan; koneksi yang jadi
 * muncul belakangan lewat `events.onConnection`, dan kegagalannya lewat
 * `events.onConnectError` (tepat satu kali, tidak pernah melempar).
 */
export const connectOutbound = (
	options: ConnectOptions,
	events: TransportEvents,
): OutboundHandle => {
	let cancelled = false
	let notifiedConnectError = false
	/** Koneksi yang sudah terbentuk; kosong sebelum `open` / setelah tutup. */
	let connection: TcpConnection | undefined = undefined
	/** Socket aktif (untuk `cancel` sebelum atau sesudah `open`). */
	let activeSocket: Bun.Socket<undefined> | undefined = undefined

	/** Laporkan kegagalan sambung — sekali saja, tanpa pernah melempar. */
	const notifyConnectError = (reason: string): void => {
		if (notifiedConnectError) return
		notifiedConnectError = true
		events.onConnectError(options.host, options.port, reason)
	}

	try {
		Bun.connect<undefined>({
			hostname: options.host,
			port: options.port,
			socket: {
				open(socket) {
					activeSocket = socket
					if (cancelled) {
						// Dibatalkan sebelum sempat terbuka — tutup paksa.
						terminateQuietly(socket)
						return
					}
					try {
						const wrapper = new TcpConnection(socket, {
							id: nextConnectionId(),
							inbound: false,
							maxMessageBytes: options.maxMessageBytes,
							events,
						})
						connection = wrapper
						events.onConnection(wrapper, false)
					} catch (error) {
						// Socket hilang atau pemilik melempar — laporkan satu sinyal
						// kegagalan, jangan gugurkan proses.
						const reason = describeError(error)
						console.error(`P2P: koneksi keluar gagal ditangani: ${reason}`)
						const failed = connection
						connection = undefined
						terminateQuietly(socket)
						if (failed) {
							failed.handleSocketClose('gagal ditangani: ' + reason)
						} else {
							notifyConnectError(reason)
						}
					}
				},
				data(_socket, chunk) {
					connection?.feed(new Uint8Array(chunk))
				},
				close(_socket, error) {
					connection?.handleSocketClose(
						error ? 'error: ' + error.message : 'ditutup peer',
					)
					connection = undefined
					activeSocket = undefined
				},
				error(_socket, error) {
					connection?.handleSocketClose('error: ' + error.message)
					connection = undefined
				},
				connectError(_socket, error) {
					notifyConnectError(describeError(error))
				},
			},
		}).catch((error: unknown) => {
			// Sambungan gagal sebelum `open` — janji ditolak; jangan jadi
			// unhandled rejection, cukup laporkan ke pemilik.
			notifyConnectError(describeError(error))
		})
	} catch (error) {
		// Gagal sebelum janji sempat terbentuk — tetap lapor, jangan melempar.
		notifyConnectError(describeError(error))
	}

	return {
		cancel(): void {
			cancelled = true
			if (activeSocket) terminateQuietly(activeSocket)
		},
	}
}
