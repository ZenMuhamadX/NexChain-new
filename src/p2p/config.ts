/**
 * Konfigurasi P2P dari environment.
 *
 * Default AMAN: P2P mati kecuali `NEX_P2P_ENABLED` diset truthy. Node
 * tunggal yang sudah ada (dev lokal) tidak berubah perilakunya sampai P2P
 * dinyalakan eksplisit. Saat menyala, bind default loopback — sama seperti
 * kebijakan RPC (`RPC_BIND_HOST`).
 */
import os from 'node:os'

/** Batas atas ukuran pesan (byte) — pagar terhadap pesan raksasa. */
export const DEFAULT_MAX_MESSAGE_BYTES = 10 * 1024 * 1024 // 10 MB

export interface PeerEndpoint {
	host: string
	port: number
}

export interface P2PConfig {
	enabled: boolean
	port: number
	bindHost: string
	peers: PeerEndpoint[]
	maxPeers: number
	maxMessageBytes: number
	/** Batas waktu handshake (ms) sejak koneksi terbuka. */
	handshakeTimeoutMs: number
	/** Batas waktu idle (ms) tanpa lalu lintas apa pun sebelum putus. */
	idleTimeoutMs: number
	/** Interval ping keepalive (ms). */
	pingIntervalMs: number
	/** Durasi ban peer pelanggar (ms). */
	banDurationMs: number
	/** Interval percobaan reconnect ke bootstrap peer (ms). */
	reconnectIntervalMs: number
	/**
	 * Interval penyegaran sync berkala (ms). Peer yang sudah lama tidak
	 * mengumumkan blok baru tetap ditengok lewat `getblocks` berkala, sehingga
	 * node tidak bergantung pada push dan tetap mengejar bila push hilang.
	 */
	syncIntervalMs: number
	/**
	 * Batas waktu (ms) fase "syncing" tanpa kemajuan sebelum node menganggap
	 * rantai sudah menyusul dan membuka kembali mining. Ini KATUP PENGAMAN
	 * (floor) agar peer yang mandek / seed yang tak terjangkau tidak menahan
	 * mining selamanya. Lihat `src/core/events/syncState.ts`.
	 */
	syncTimeoutMs: number
	/**
	 * Banyak item yang dilayani per giliran sebelum `yieldToLoop()` (pacing).
	 * Mencegah satu permintaan peer memonopoli event loop — RPC/UI tetap
	 * responsif saat IBD. Default 32 (±8 giliran untuk batch `MAX_INV_BATCH`).
	 */
	serveChunkSize: number
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

/** Apakah string env bernilai "menyala". */
export const isTruthy = (value: string | undefined): boolean =>
	value !== undefined && TRUTHY.has(value.trim().toLowerCase())

const positiveInt = (
	raw: string | undefined,
	fallback: number,
	min = 1,
): number => {
	if (raw === undefined || raw.trim() === '') return fallback
	const value = Number(raw)
	if (!Number.isSafeInteger(value) || value < min) return fallback
	return value
}

/**
 * Parse daftar bootstrap peer: `host:port,host:port`.
 * Entri tidak valid (port di luar 1..65535, host kosong) dilewati dengan
 * peringatan — bukan menggagalkan boot seluruh node.
 */
export const parsePeerList = (raw: string | undefined): PeerEndpoint[] => {
	if (!raw || raw.trim() === '') return []
	const out: PeerEndpoint[] = []
	for (const entry of raw.split(',')) {
		const trimmed = entry.trim()
		if (trimmed === '') continue
		// IPv6 tanpa bracket tidak didukung di v1 — cukup untuk devnet IPv4.
		const idx = trimmed.lastIndexOf(':')
		if (idx <= 0) {
			console.warn(`P2P: entri peer tidak valid (${trimmed}) — dilewati`)
			continue
		}
		const rawHost = trimmed.slice(0, idx)
		// `localhost` dinormalkan ke `127.0.0.1` supaya seed cocok dengan
		// `remoteAddress` koneksi MASUK dari loopback. Koneksi keluar tidak
		// lagi bergantung pada ini: peer manager memakai `dialKey` (endpoint
		// konfigurasi apa adanya), jadi hostname mana pun aman.
		const host = rawHost.toLowerCase() === 'localhost' ? '127.0.0.1' : rawHost
		const port = Number(trimmed.slice(idx + 1))
		if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
			console.warn(`P2P: entri peer tidak valid (${trimmed}) — dilewati`)
			continue
		}
		out.push({ host, port })
	}
	return out
}

/**
 * Bangun konfigurasi dari environment (default `process.env`).
 * Fungsi dipisah dari pembacaan langsung supaya bisa diuji murni.
 */
export const loadP2PConfig = (
	env: NodeJS.ProcessEnv = process.env,
): P2PConfig => {
	const enabled = isTruthy(env.NEX_P2P_ENABLED)
	return {
		enabled,
		port: positiveInt(env.NEX_P2P_PORT, 30303),
		bindHost: env.NEX_P2P_BIND_HOST?.trim() || '127.0.0.1',
		peers: parsePeerList(env.NEX_P2P_PEERS),
		maxPeers: positiveInt(env.NEX_P2P_MAX_PEERS, 8),
		maxMessageBytes: positiveInt(
			env.NEX_P2P_MAX_MSG_BYTES,
			DEFAULT_MAX_MESSAGE_BYTES,
		),
		handshakeTimeoutMs: positiveInt(env.NEX_P2P_HANDSHAKE_TIMEOUT_MS, 10_000),
		idleTimeoutMs: positiveInt(env.NEX_P2P_IDLE_TIMEOUT_MS, 120_000),
		pingIntervalMs: positiveInt(env.NEX_P2P_PING_INTERVAL_MS, 30_000),
		banDurationMs: positiveInt(env.NEX_P2P_BAN_MS, 60 * 60 * 1000),
		reconnectIntervalMs: positiveInt(env.NEX_P2P_RECONNECT_INTERVAL_MS, 15_000),
		syncIntervalMs: positiveInt(env.NEX_P2P_SYNC_INTERVAL_MS, 10_000),
		// Floor 1000 ms: nilai lebih kecil (termasuk 0/negatif) jatuh ke default
		// 60_000 — mencegah katup pengaman mati karena salah setel.
		syncTimeoutMs: positiveInt(env.NEX_P2P_SYNC_TIMEOUT_MS, 60_000, 1_000),
		serveChunkSize: positiveInt(env.NEX_P2P_SERVE_CHUNK, 32),
	}
}

/** IPv4 non-internal pertama. Dipakai HANYA untuk menampilkan bind. */
export const pickLanIPv4 = (
	interfaces: ReturnType<typeof os.networkInterfaces>,
): string | undefined => {
	for (const list of Object.values(interfaces)) {
		for (const info of list ?? []) {
			if (info.family === 'IPv4' && !info.internal) return info.address
		}
	}
	return undefined
}

/**
 * Alamat yang ditampilkan di log listener. `0.0.0.0`/`::` berarti "semua
 * antarmuka" — tampilkan IPv4 LAN nyata supaya operator bisa menyalinnya
 * sebagai seed. Ini hanya kosmetik: bind-nya tetap ke semua antarmuka, dan
 * `bindHost` asli tetap jadi fallback bila mesin tak punya IPv4 non-internal.
 */
export const describeBindHost = (
	bindHost: string,
	interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
): string =>
	bindHost === '0.0.0.0' || bindHost === '::'
		? (pickLanIPv4(interfaces) ?? bindHost)
		: bindHost
