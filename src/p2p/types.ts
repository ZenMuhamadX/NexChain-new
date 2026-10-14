/**
 * Tipe bersama antar-modul P2P.
 *
 * File ini adalah KONTRAK yang dipakai lintas modul (transport, handshake,
 * peer manager, sync). Sengaja murni tipe + konstanta supaya tidak ada
 * dependensi melingkar.
 */
import type { P2PMessage } from './protocol/messages.js'
import type { P2PConfig } from './config.js'

/** Status rantai lokal yang dikirim di handshake `version`. */
export interface LocalChainStatus {
	chainId: number
	genesisHash: string
	bestHeight: number
	bestHash: string
	/** Port listen P2P lokal (opsional). */
	listenPort?: number
}

/** Alasan putus koneksi yang dicatat peer manager. */
export type DisconnectReason = string

/**
 * Satu koneksi TCP yang sudah di-frame.
 *
 * `send` sinkron dan best-effort: bila socket sudah tertutup, pesan diabaikan
 * (peer manager bertanggung jawab menutup dan membersihkan state).
 */
export interface PeerConnection {
	readonly id: string
	readonly remoteAddress: string
	readonly remotePort: number
	readonly inbound: boolean
	isOpen(): boolean
	send(message: P2PMessage): void
	close(reason?: DisconnectReason): void
}

/** Koneksi + status handshake yang dilacak peer manager. */
export interface PeerState {
	connection: PeerConnection
	handshaked: boolean
	/** Data `version` peer setelah handshake. */
	status?: LocalChainStatus
	connectedAt: number
	lastSeenAt: number
}

/** Konfigurasi yang dibutuhkan transport saat membuka koneksi. */
export type TransportConfig = Pick<P2PConfig, 'maxMessageBytes' | 'bindHost'>

/**
 * Hasil validasi satu blok asing sebelum di-commit.
 *
 * `fatal=true` berarti pelanggaran konsensus yang layak memutus + mem-ban
 * peer pengirim (mis. PoW palsu, hash salah). `fatal=false` berarti blok
 * ditolak karena alasan non-pelanggaran (mis. tidak menempel ke tip kita —
 * bisa jadi tembakan lintas karena race), jadi cukup diabaikan.
 */
export interface ConnectBlockResult {
	ok: boolean
	reason?: string
	fatal: boolean
}

/**
 * Gateway yang dipakai lapisan sync/broadcast untuk bicara ke jaringan.
 * Disembunyikan di balik antarmuka supaya sync manager tidak bergantung pada
 * implementasi konkret peer manager (dan mudah diuji dengan gateway palsu).
 */
export interface P2PGateway {
	/** Kirim satu pesan ke peer; no-op bila peer sudah tidak ada. */
	send(peerId: string, message: P2PMessage): void
	/** Sebar pesan ke semua peer (opsional kecuali satu). Balikan = jumlah terkirim. */
	broadcast(message: P2PMessage, exceptPeerId?: string): number
	/** Peer yang sedang terhubung dan sudah handshake. */
	readyPeers(): PeerState[]
	/**
	 * Ban alamat remote: tutup semua koneksinya dan tolak koneksi baru selama
	 * durasi ban. Dipakai sync manager saat peer melanggar aturan protokol.
	 */
	ban(remoteAddress: string, reason: string): void
}

/** Peristiwa yang di-*emit* peer manager (didaftarkan oleh node). */
export interface PeerEvents {
	onPeerReady(peer: PeerState): void
	onPeerMessage(peer: PeerState, message: P2PMessage): void
	onPeerClosed(peer: PeerState, reason: string): void
}

/**
 * Antarmuka peer manager yang dipakai node orchestrator.
 * Implementasi konkret ada di `peers/peerManager.ts`.
 */
export interface PeerManager extends P2PGateway {
	start(): Promise<void>
	stop(): void
	list(): PeerState[]
	get(id: string): PeerState | undefined
	ban(remoteAddress: string, reason: string): void
	isBanned(remoteAddress: string): boolean
}

// ---------------------------------------------------------------------------
// Kontrak transport (TCP) — dibekukan agar peer manager & server/connector
// tidak pernah berbeda asumsi.
// ---------------------------------------------------------------------------

/** Peristiwa transport. Pemilik (peer manager) mengimplementasikannya. */
export interface TransportEvents {
	/** Koneksi baru terbuka (inbound dari listener atau outbound dari connect). */
	onConnection(connection: PeerConnection, inbound: boolean): void
	/** Pesan utuh tiba dari `connection`. */
	onMessage(connection: PeerConnection, message: P2PMessage): void
	/** Koneksi tertutup / error. `reason` ringkas untuk log. */
	onClose(connection: PeerConnection, reason: string): void
	/**
	 * Percobaan koneksi KELUAR gagal (tidak ada `PeerConnection` yang
	 * terbentuk). Dipakai peer manager untuk menjadwalkan ulang reconnect.
	 */
	onConnectError(host: string, port: number, reason: string): void
}

/** Handle listener TCP yang sedang berjalan. */
export interface ServerHandle {
	readonly port: number
	stop(): void
}

/** Handle percobaan koneksi keluar yang masih berjalan. */
export interface OutboundHandle {
	cancel(): void
}

/** Options listener TCP. */
export interface ServerOptions {
	bindHost: string
	port: number
	maxMessageBytes: number
}

/** Options koneksi keluar. */
export interface ConnectOptions {
	host: string
	port: number
	maxMessageBytes: number
}

/** Options pembuatan peer manager (injeksi untuk pengujian). */
export interface PeerManagerOptions {
	config: P2PConfig
	getLocalStatus: () => Promise<LocalChainStatus>
	events: PeerEvents
}

/** Options pembuatan sync manager. */
export interface SyncManagerOptions {
	config: P2PConfig
	gateway: P2PGateway
	getLocalStatus: () => Promise<LocalChainStatus>
	connectBlock: (raw: unknown) => Promise<ConnectBlockResult>
}

/**
 * Antarmuka sync manager (protokol getblocks/inv/getdata/block/tx).
 * Implementasi konkret ada di `sync/syncManager.ts`.
 */
export interface SyncManager {
	start(): void
	stop(): void
	/** Peer selesai handshake — mulai/tambah target sinkronisasi. */
	onPeerReady(peer: PeerState): void
	/** Pesan protokol dari peer (setelah handshake). */
	onPeerMessage(peer: PeerState, message: P2PMessage): void
	onPeerClosed(peer: PeerState): void
	/** Umumkan hash blok lokal baru ke jaringan (dari bus core). */
	announceBlock(blockHash: string): void
	/** Umumkan hash transaksi lokal baru ke jaringan (dari bus core). */
	announceTx(txHash: string): void
	/** Minta blok dari peer terbaik (dipakai interval penyegaran berkala). */
	requestSync(peer?: PeerState): void
}
