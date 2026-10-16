/// <reference types="bun-types" />
/**
 * Satu koneksi TCP yang dibungkus menjadi `PeerConnection`.
 *
 * Kelas ini satu-satunya tempat lapisan transport menyentuh socket Bun:
 * menelan potongan byte mentah lewat `FrameDecoder`, meneruskan pesan utuh
 * ke pemilik lewat `TransportEvents`, dan menulis frame keluar secara
 * sinkron (best-effort). Semua kegagalan I/O diarahkan ke penutupan
 * koneksi — tidak ada yang boleh menggugurkan proses node.
 *
 * Dua penjaga dipakai bersama:
 * - `closed` — koneksi sudah tidak aktif; `send`/`feed` jadi no-op.
 * - `notifiedClose` — `onClose` dipanggil SATU kali saja, berapa pun sumber
 *   penutupannya (graceful, paksa, error socket, server berhenti).
 *
 * Alasan putus terakhir disimpan di `closeReason` supaya alasan internal
 * (mis. `framing: …`) tidak hilang ketika handler socket memanggil
 * `handleSocketClose` dengan alasan generik seperti `ditutup peer`.
 */
import type { P2PMessage } from '../protocol/messages.js'
import type { PeerConnection, TransportEvents } from '../types.js'
import { encodeFrame, FrameDecoder } from './framing.js'

/** Opsi pembuatan `TcpConnection`. */
export interface TcpConnectionOptions {
	/** Id unik koneksi (dibuat oleh `server.ts`). */
	id: string
	/** Apakah koneksi masuk dari listener. */
	inbound: boolean
	/**
	 * `host:port` yang didial (koneksi keluar saja). Lihat
	 * `PeerConnection.dialKey` — inilah identitas yang dipakai peer manager,
	 * karena `remoteAddress` sudah berupa alamat hasil resolusi.
	 */
	dialKey?: string | undefined
	/** Batas ukuran pesan (byte) untuk encode dan decode. */
	maxMessageBytes: number
	/** Pemilik koneksi (peer manager) — semua peristiwa diteruskan ke sini. */
	events: TransportEvents
}

/** Ambil pesan singkat dari nilai error apa pun. */
const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

/** Pembungkus socket Bun yang mengimplementasikan `PeerConnection`. */
export class TcpConnection implements PeerConnection {
	readonly id: string
	readonly inbound: boolean
	readonly remoteAddress: string
	readonly remotePort: number
	readonly dialKey: string | undefined

	private readonly socket: Bun.Socket<undefined>
	private readonly maxMessageBytes: number
	private readonly events: TransportEvents
	private readonly decoder: FrameDecoder
	/** Penanda koneksi sudah tidak aktif (tutup graceful / paksa / error). */
	private closed = false
	/** Penanda `onClose` sudah dipanggil — jangan panggil dua kali. */
	private notifiedClose = false
	/** Alasan putus terakhir yang diketahui koneksi ini (opsional). */
	private closeReason: string | undefined = undefined

	constructor(socket: Bun.Socket<undefined>, options: TcpConnectionOptions) {
		this.socket = socket
		this.id = options.id
		this.inbound = options.inbound
		// Socket yang baru saja mati bisa saja belum punya alamat remote.
		this.remoteAddress = socket.remoteAddress || 'unknown'
		this.remotePort = socket.remotePort || 0
		this.dialKey = options.dialKey
		this.maxMessageBytes = options.maxMessageBytes
		this.events = options.events
		this.decoder = new FrameDecoder(options.maxMessageBytes)
	}

	/**
	 * Terima potongan byte mentah dari handler `data` socket.
	 *
	 * Decoder menghasilkan pesan utuh (bisa lebih dari satu per potongan).
	 * Bila frame cacat, koneksi langsung diputus dan `onClose` dipicu oleh
	 * handler `close` socket.
	 */
	feed(chunk: Uint8Array): void {
		if (this.closed) return
		let messages: P2PMessage[] = []
		try {
			messages = this.decoder.push(chunk)
		} catch (error) {
			this.destroy('framing: ' + describeError(error))
			return
		}
		for (const message of messages) {
			this.events.onMessage(this, message)
		}
	}

	/**
	 * Kirim satu pesan (sinkron, best-effort). No-op bila koneksi sudah
	 * tertutup; bila encoding/tulis gagal, koneksi diputus paksa.
	 */
	send(message: P2PMessage): void {
		if (this.closed) return
		try {
			this.socket.write(encodeFrame(message, this.maxMessageBytes))
		} catch (error) {
			this.destroy('kirim gagal: ' + describeError(error))
		}
	}

	/** Tutup sopan (kirim FIN). Idempoten; `reason` dicatat untuk `onClose`. */
	close(reason?: string): void {
		if (this.closed) return
		this.closed = true
		if (reason !== undefined) this.closeReason = reason
		try {
			this.socket.end()
		} catch {
			// socket sudah mati — abaikan
		}
	}

	/** Tutup paksa (terminate). Idempoten; dipakai saat framing/tulis gagal. */
	destroy(reason: string): void {
		if (this.closeReason === undefined) this.closeReason = reason
		if (this.closed) return
		this.closed = true
		try {
			this.socket.terminate()
		} catch {
			// socket sudah mati — abaikan
		}
	}

	/**
	 * Dipanggil handler socket `close`/`error` — menandai koneksi tutup dan
	 * memicu `onClose` tepat satu kali.
	 */
	handleSocketClose(reason: string): void {
		this.closed = true
		if (this.notifiedClose) return
		this.notifiedClose = true
		this.events.onClose(this, this.closeReason ?? reason)
	}

	/** Apakah koneksi masih terbuka untuk dibaca/ditulis. */
	isOpen(): boolean {
		return !this.closed
	}
}
