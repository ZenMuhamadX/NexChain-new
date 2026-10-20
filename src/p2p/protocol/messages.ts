/**
 * Kontrak pesan P2P NexChain (protokol v2).
 *
 * Semua pesan adalah objek JSON dengan field `type` sebagai diskriminan.
 * Modul ini SENGAJA murni (tanpa I/O, tanpa Node API) supaya bisa dipakai
 * bareng oleh transport, sync, dan tooling uji.
 *
 * Badan blok & transaksi TIDAK lagi dikirim sebagai JSON mentah: keduanya
 * dibawa sebagai string base64 berisi RLP (`encodeBlock`/`encodeTx`), sehingga
 * nama field tidak diulang di setiap pesan. Konvensi: `block` → `payload`
 * base64, `tx` → `payload` base64 RLP bertipe `0x02`.
 *
 * Konvensi rentang hash (dua ruang terpisah, JANGAN disamakan):
 *   - `block`  → 64 digit hex huruf kecil (SHA-256)
 *   - `tx`     → `TxC` + 64 digit hex huruf kecil (67 karakter) — lihat
 *     `src/core/encoding/rlp/txHash.ts`
 *
 * Hash blok dan hash tx sengaja berbeda bentuk supaya tidak tertukar; karena
 * itu validasi `inv`/`getdata` bersifat PER-KIND, bukan "semua hex64".
 *
 * Alamat peer: `host:port`.
 */
import { isTxHash } from 'src/core/encoding/rlp/txHash'

/**
 * Versi protokol wire. Naikkan bila ketidakcocokan antar-node harus TERLIHAT
 * di handshake, bukan sebagai ban membingungkan di tengah sync.
 *
 * v2 → v3 (C1): skema pesan tidak berubah, tapi ATURAN VERIFIKASI blok
 * berubah tidak-kompatibel (`size` kini diverifikasi: wajib = Σ byte wire tx
 * dan ≤ `MAX_BLOCK_WIRE_BYTES`, jumlah tx ≤ `MAX_TX_PER_BLOCK`). Node lama
 * menghasilkan blok yang pasti ditolak node baru dan sebaliknya — tanpa
 * bump, keduanya saling membanned setelah terhubung; dengan bump, mereka
 * menolak satu sama lain di handshake (fatal → ban, jalur yang sama).
 * Semua node dan semua `NEX_P2P_PEERS` harus naik bersamaan.
 */
export const P2P_PROTOCOL_VERSION = 3

/** Batas jumlah hash dalam satu `inv` / item dalam satu `getdata`. */
export const MAX_INV_BATCH = 256

export type InvKind = 'block' | 'tx'

/** Handshake pembuka: identitas jaringan + posisi rantai pengirim. */
export interface VersionMessage {
	type: 'version'
	protocolVersion: number
	/** EIP-155 chain id — wajib sama dengan peer. */
	chainId: number
	/** Hash genesis — identitas jaringan (anti-fork / anti-confusion). */
	genesisHash: string
	bestHeight: number
	bestHash: string
	/** Port listen pengirim (opsional, untuk gossip alamat nanti). */
	listenPort?: number
}

/** Balasan handshake. */
export interface VerackMessage {
	type: 'verack'
}

export interface PingMessage {
	type: 'ping'
	nonce: number
}

export interface PongMessage {
	type: 'pong'
	nonce: number
}

/**
 * Minta daftar hash blok setelah titik temu.
 * `locator` diisi dari tip mundur (indeks 0 = tip), `stopHash` biasanya
 * 64 "0" (sampai awal rantai).
 */
export interface GetBlocksMessage {
	type: 'getblocks'
	locator: string[]
	stopHash: string
}

/** Pengumuman ketersediaan blok/transaksi (hanya hash). */
export interface InvMessage {
	type: 'inv'
	kind: InvKind
	hashes: string[]
}

export interface GetDataItem {
	kind: InvKind
	hash: string
}

/** Permintaan badan blok/transaksi berdasarkan hash. */
export interface GetDataMessage {
	type: 'getdata'
	items: GetDataItem[]
}

/**
 * Badan blok — string base64 berisi RLP blok (`encodeBlock` di
 * `src/core/encoding/hex/block/`). Menggantikan JSON mentah `Block` sejak
 * protokol v2.
 */
export interface BlockMessage {
	type: 'block'
	payload: string
}

/** Transaksi — string base64 RLP hasil `encodeTx` (kontrak wire yang sama). */
export interface TxMessage {
	type: 'tx'
	payload: string
}

export type P2PMessage =
	| VersionMessage
	| VerackMessage
	| PingMessage
	| PongMessage
	| GetBlocksMessage
	| InvMessage
	| GetDataMessage
	| BlockMessage
	| TxMessage

/** Nama-nama pesan yang dikenal protokol v2. */
export const MESSAGE_TYPES = [
	'version',
	'verack',
	'ping',
	'pong',
	'getblocks',
	'inv',
	'getdata',
	'block',
	'tx',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const isHex64 = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0

/**
 * Bentuk string base64 (kanonik, padding baku).
 *
 * Fail-closed terhadap payload `block`: isi blok diverifikasi di
 * `connectBlock`, tetapi bentuk pembungkusnya diperiksa di sini supaya peer
 * yang mengirim sampah ditandai sejak lapisan protokol — bukan setelah
 * `atob`/RLP gagal di tengah decode.
 */
const isBase64 = (value: unknown): value is string =>
	isNonEmptyString(value) &&
	value.length % 4 === 0 &&
	/^[A-Za-z0-9+/]+={0,2}$/.test(value)

const isSafeInt = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value)

const isStringArray = (value: unknown, max: number): value is string[] =>
	Array.isArray(value) &&
	value.length <= max &&
	value.every((item) => typeof item === 'string')

const isHex64Array = (value: unknown, max: number): value is string[] =>
	isStringArray(value, max) && value.every((item) => isHex64(item))

const isInvKind = (value: unknown): value is InvKind =>
	value === 'block' || value === 'tx'

/**
 * Validasi hash sesuai KIND-nya: hash blok 64 hex, hash tx `TxC`+64 hex.
 *
 * Ini yang membuat `inv`/`getdata` bertransaksi bisa diterima: sebelumnya
 * `TxC…` (67 karakter) selalu ditolak `isHex64Array`, sehingga peer dianggap
 * rusak dan relay tx tidak pernah jalan.
 */
const isHashForKind = (value: unknown, kind: InvKind): value is string =>
	kind === 'tx' ? isTxHash(value) : isHex64(value)

const isHashArrayForKind = (
	value: unknown,
	kind: InvKind,
	max: number,
): value is string[] =>
	isStringArray(value, max) && value.every((item) => isHashForKind(item, kind))

/**
 * Validasi bentuk pesan yang datang dari jaringan.
 *
 * Fail-closed: payload yang tidak persis sesuai bentuk baku mengembalikan
 * `undefined`, sehingga pemanggil bisa memutus/menandai peer pelanggar.
 * TIDAK melakukan normalisasi — bentuk longgar mengundang bug senyap.
 */
export const parseMessage = (raw: unknown): P2PMessage | undefined => {
	if (!isRecord(raw)) return undefined
	const type = raw.type

	switch (type) {
		case 'version': {
			if (!isSafeInt(raw.protocolVersion)) return undefined
			if (!isSafeInt(raw.chainId)) return undefined
			if (!isHex64(raw.genesisHash)) return undefined
			if (!isSafeInt(raw.bestHeight) || raw.bestHeight < 0) return undefined
			if (typeof raw.bestHash !== 'string') return undefined
			if (
				raw.listenPort !== undefined &&
				(!isSafeInt(raw.listenPort) ||
					raw.listenPort <= 0 ||
					raw.listenPort > 65535)
			) {
				return undefined
			}
			const message: VersionMessage = {
				type: 'version',
				protocolVersion: raw.protocolVersion,
				chainId: raw.chainId,
				genesisHash: raw.genesisHash,
				bestHeight: raw.bestHeight,
				bestHash: raw.bestHash,
			}
			if (raw.listenPort !== undefined) message.listenPort = raw.listenPort
			return message
		}
		case 'verack':
			return { type: 'verack' }
		case 'ping':
		case 'pong': {
			if (!isSafeInt(raw.nonce)) return undefined
			return { type, nonce: raw.nonce }
		}
		case 'getblocks': {
			if (!isHex64Array(raw.locator, MAX_INV_BATCH)) return undefined
			if (!isHex64(raw.stopHash)) return undefined
			return {
				type: 'getblocks',
				locator: raw.locator,
				stopHash: raw.stopHash,
			}
		}
		case 'inv': {
			if (!isInvKind(raw.kind)) return undefined
			if (!isHashArrayForKind(raw.hashes, raw.kind, MAX_INV_BATCH)) {
				return undefined
			}
			return { type: 'inv', kind: raw.kind, hashes: raw.hashes }
		}
		case 'getdata': {
			if (!Array.isArray(raw.items) || raw.items.length > MAX_INV_BATCH) {
				return undefined
			}
			const items: GetDataItem[] = []
			for (const item of raw.items) {
				if (!isRecord(item)) return undefined
				if (!isInvKind(item.kind)) return undefined
				if (!isHashForKind(item.hash, item.kind)) return undefined
				items.push({ kind: item.kind, hash: item.hash })
			}
			return { type: 'getdata', items }
		}
		case 'block': {
			if (!isBase64(raw.payload)) return undefined
			return { type: 'block', payload: raw.payload }
		}
		case 'tx': {
			if (!isNonEmptyString(raw.payload)) return undefined
			return { type: 'tx', payload: raw.payload }
		}
		default:
			return undefined
	}
}
