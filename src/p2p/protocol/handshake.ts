/**
 * Aturan handshake `version` — murni, tanpa I/O.
 *
 * Dipisah dari peer manager supaya bisa diuji tanpa socket. Pesan `version`
 * adalah satu-satunya titik di mana identitas jaringan diperiksa: chain id dan
 * genesis hash yang berbeda berarti peer itu bukan bagian jaringan ini, dan
 * melanjutkan koneksi hanya membuang bandwidth (atau lebih buruk).
 */
import { P2P_PROTOCOL_VERSION, type VersionMessage } from './messages'
import type { LocalChainStatus } from '../types'

export interface HandshakeState {
	sentVersion: boolean
	receivedVersion: boolean
	sentVerack: boolean
	receivedVerack: boolean
}

export const createHandshakeState = (): HandshakeState => ({
	sentVersion: false,
	receivedVersion: false,
	sentVerack: false,
	receivedVerack: false,
})

/** Handshake selesai bila kedua sisi mengirim `version` DAN `verack`. */
export const isHandshakeComplete = (state: HandshakeState): boolean =>
	state.sentVersion &&
	state.receivedVersion &&
	state.sentVerack &&
	state.receivedVerack

/** Susun pesan `version` dari status rantai lokal. */
export const buildVersionMessage = (
	status: LocalChainStatus,
	protocolVersion: number = P2P_PROTOCOL_VERSION,
): VersionMessage => {
	const message: VersionMessage = {
		type: 'version',
		protocolVersion,
		chainId: status.chainId,
		genesisHash: status.genesisHash,
		bestHeight: status.bestHeight,
		bestHash: status.bestHash,
	}
	if (status.listenPort !== undefined) message.listenPort = status.listenPort
	return message
}

export interface VersionCheck {
	ok: boolean
	/**
	 * `true` bila ketidakcocokan berarti peer bukan bagian jaringan ini
	 * (chain id / genesis beda) — layak diputus dan tidak dihubungi lagi.
	 * Ketidakcocokan versi protokol juga fatal untuk v1 (tidak ada negosiasi
	 * turun-versi).
	 */
	fatal: boolean
	reason?: string
}

/**
 * Periksa `version` peer terhadap ekspektasi jaringan lokal.
 *
 * Urutan penting: identitas jaringan (genesis, lalu chain id) diperiksa
 * SEBELUM versi protokol, supaya peer dari jaringan lain dilaporkan sebagai
 * "bukan jaringan ini", bukan sekadar "versi beda".
 */
export const checkVersionMessage = (
	message: VersionMessage,
	expected: {
		chainId: number
		genesisHash: string
		protocolVersion: number
	},
): VersionCheck => {
	if (message.genesisHash !== expected.genesisHash) {
		return {
			ok: false,
			fatal: true,
			reason: `genesis berbeda (${message.genesisHash.slice(0, 16)}… != ${expected.genesisHash.slice(0, 16)}…)`,
		}
	}
	if (message.chainId !== expected.chainId) {
		return {
			ok: false,
			fatal: true,
			reason: `chain id berbeda (${message.chainId} != ${expected.chainId})`,
		}
	}
	if (message.protocolVersion !== expected.protocolVersion) {
		return {
			ok: false,
			fatal: true,
			reason: `versi protokol tidak didukung (${message.protocolVersion} != ${expected.protocolVersion})`,
		}
	}
	return { ok: true, fatal: false }
}
