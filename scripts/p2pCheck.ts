/**
 * Gerbang regresi offline lapisan P2P (`check:p2p`).
 *
 * Jalankan:  bun run check:p2p
 *
 * Seluruhnya MURNI: tanpa jaringan, tanpa LevelDB, tanpa mutasi
 * `process.env`. Modul yang diuji (`src/p2p/transport/framing.ts`,
 * `src/p2p/protocol/messages.ts`, `src/p2p/config.ts`,
 * `src/p2p/protocol/handshake.ts`, `src/p2p/broadcastGate.ts`,
 * `src/p2p/peers/banList.ts`) sengaja tidak menyentuh I/O supaya tes ini
 * aman dijalankan kapan pun.
 *
 * Kelompok yang dicegah regresinya di sini:
 *
 *   1. **Framing** — round-trip encode/decode, potongan TCP (byte-per-byte
 *      maupun dua bagian), banyak frame dalam satu chunk, frame raksasa
 *      dan payload non-JSON DITOLAK dengan `FrameError` sebelum dialokasikan.
 *   2. **parseMessage** — fail-closed: bentuk rusak/tidak dikenal →
 *      `undefined`; bentuk sah diterima.
 *   3. **Batas `MAX_INV_BATCH`** — `inv`/`getdata` melebihi batas ditolak.
 *   3b. **Bentuk hash per-kind** — hash tx (`TxC` + 64 hex, 67 karakter)
 *      dan hash blok (64 hex) TIDAK boleh tertukar; `inv`/`getdata` divalidasi
 *      sesuai `kind`. Ini menjaga relay transaksi tetap hidup.
 *   4. **Config** — default aman (P2P mati, loopback, port 30303), parsing env
 *      (entri peer tidak valid dilewati), dan katup `syncTimeoutMs` (floor).
 *   5. **Handshake** — genesis / chain id / versi protokol berbeda = fatal;
 *      kecocokan persis = lolos; `buildVersionMessage` tidak membuang
 *      field status rantai.
 *   6. **Ban list** — kedaluwarsa malas berbasis waktu tersuntik; `lift`
 *      mengangkat larangan lebih awal.
 *   7. **Broadcast gate** — penekanan siaran turun-naik dengan benar,
 *      termasuk bersarang dan saat isi fungsi melempar.
 *   8. **Status sinkronisasi** — gerbang IBD (`isSyncing`) tak menyala secara
 *      default; latch "synced" tak bisa diturunkan, sedangkan fase `assumed`
 *      (katup pengaman) masih boleh ditutup kembali.
 *   9. **Observability peer** — snapshot netral `src/core/events/peerState.ts`
 *      yang dibaca `nex_getPeerInfo` (salinan, bukan referensi state p2p).
 *  10. **Arah dependensi** — `src/core/**` TIDAK boleh mengimpor `src/p2p/**`
 *      (p2p adalah konsumen core, bukan sebaliknya).
 *  11. **Pacing serve** — `yieldToLoop` menyerahkan batas makrotask dan
 *      `forEachChunked` menyisipkan yield tepat di antara chunk (bukan setelah
 *      item terakhir), supaya loop layanan tak memonopoli event loop bersama RPC.
 */
import {
	encodeFrame,
	FrameDecoder,
	FrameError,
	LENGTH_PREFIX_BYTES,
} from 'src/p2p/transport/framing'
import {
	parseMessage,
	P2P_PROTOCOL_VERSION,
	MAX_INV_BATCH,
} from 'src/p2p/protocol/messages'
import {
	loadP2PConfig,
	parsePeerList,
	DEFAULT_MAX_MESSAGE_BYTES,
	describeBindHost,
	pickLanIPv4,
} from 'src/p2p/config'
import {
	buildVersionMessage,
	checkVersionMessage,
	createHandshakeState,
	isHandshakeComplete,
} from 'src/p2p/protocol/handshake'
import { runSuppressed, isBroadcastSuppressed } from 'src/p2p/broadcastGate'
import { BanList } from 'src/p2p/peers/banList'
import { forEachChunked, yieldToLoop } from 'src/p2p/scheduling'
import { isTxHash, TX_HASH_PREFIX } from 'src/core/encoding/rlp/txHash'
import {
	getSyncStatus,
	isSyncing,
	markAssumed,
	markForked,
	markSynced,
	markSyncing,
	resetSyncState,
} from 'src/core/events/syncState'
import {
	getPeerStateSnapshot,
	resetPeerState,
	updateBans,
	updatePeers,
	type PeerInfo,
} from 'src/core/events/peerState'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { P2PMessage } from 'src/p2p/protocol/messages'
import { encodeBlock } from 'src/core/encoding/hex/block/encodeBlock'
import { decodeBlock } from 'src/core/encoding/hex/block/decodeBlock'
import { uint8ToBase64 } from 'src/core/encoding/hex/base64/uint8ToBase64'
import { buildGenesisBlock } from 'src/core/block/genesis'
import { Block } from 'src/core/block/blockModel'
import { prepareBlockForHashing } from 'src/core/block/prepareBlock'
import { createMerkleRoot } from 'src/core/transaction/utils/createMerkleRoot'
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import type { blockStruct } from 'src/types/block'
import type { comTxInterface } from 'src/types/compositeTransaction'

let pass = 0
let fail = 0

/** Tolak bila `cond` palsu — setiap pemeriksaan adalah fungsi kecil. */
const assert = (cond: boolean, message: string): void => {
	if (!cond) throw new Error(message)
}

/** Tolak bila `fn` TIDAK melempar — untuk jalur "payload rusak ditolak". */
const assertThrows = (fn: () => unknown, message: string): void => {
	let threw = false
	try {
		fn()
	} catch {
		threw = true
	}
	if (!threw) throw new Error(`${message} (tidak melempar)`)
}

/** JSON-invarian (cukup untuk data wire tanpa fungsi / undefined). */
const sameJson = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b)

/** Jalankan satu pemeriksaan bernama; galat = FAIL, bukan menghentikan gate. */
const run = async (
	name: string,
	fn: () => void | Promise<void>,
): Promise<void> => {
	try {
		await fn()
		pass++
		console.log(`  OK   ${name}`)
	} catch (error) {
		fail++
		const message = error instanceof Error ? error.message : String(error)
		console.log(`  FAIL ${name}  -> ${message}`)
	}
}

// ---------------------------------------------------------------------------
// GROUP 1 — framing: round-trip, potongan, banyak frame, frame rusak
// ---------------------------------------------------------------------------

console.log('GROUP 1 — framing (length-prefix 4 byte BE + JSON):')

await run('round-trip ping: encode → FrameDecoder → identik', () => {
	const ping: P2PMessage = { type: 'ping', nonce: 12345 }
	const frame = encodeFrame(ping, DEFAULT_MAX_MESSAGE_BYTES)
	const decoded = new FrameDecoder(DEFAULT_MAX_MESSAGE_BYTES).push(frame)
	assert(decoded.length === 1, `harus 1 pesan, dapat ${decoded.length}`)
	assert(sameJson(decoded[0], ping), 'pesan hasil decode ≠ pesan asal')
})

await run(
	'potongan byte-per-byte: pesan muncul HANYA setelah byte terakhir',
	() => {
		const frame = encodeFrame(
			{ type: 'ping', nonce: 7 },
			DEFAULT_MAX_MESSAGE_BYTES,
		)
		const decoder = new FrameDecoder(DEFAULT_MAX_MESSAGE_BYTES)
		for (let i = 0; i < frame.byteLength - 1; i++) {
			const out = decoder.push(frame.subarray(i, i + 1))
			assert(out.length === 0, `pesan prematur setelah byte ${i + 1}`)
			assert(
				decoder.buffered === i + 1,
				`buffer ${decoder.buffered} ≠ ${i + 1} (byte hilang/terbuang)`,
			)
		}
		const out = decoder.push(frame.subarray(frame.byteLength - 1))
		assert(
			out.length === 1,
			`byte terakhir harus menyelesaikan 1 pesan, dapat ${out.length}`,
		)
		assert(
			decoder.buffered === 0,
			'sisa buffer harus kosong setelah pesan utuh',
		)
	},
)

await run('potongan dua bagian (tengah frame): hasil identik', () => {
	const ping: P2PMessage = { type: 'pong', nonce: 99 }
	const frame = encodeFrame(ping, DEFAULT_MAX_MESSAGE_BYTES)
	const mid = frame.byteLength >> 1
	const decoder = new FrameDecoder(DEFAULT_MAX_MESSAGE_BYTES)
	assert(
		decoder.push(frame.subarray(0, mid)).length === 0,
		'bagian pertama belum boleh menghasilkan pesan',
	)
	const out = decoder.push(frame.subarray(mid))
	assert(
		out.length === 1 && sameJson(out[0], ping),
		'bagian kedua ≠ 1 pesan identik',
	)
})

await run('banyak frame dalam SATU chunk: urutan terjaga', () => {
	const first = encodeFrame(
		{ type: 'ping', nonce: 1 },
		DEFAULT_MAX_MESSAGE_BYTES,
	)
	const second = encodeFrame(
		{ type: 'pong', nonce: 2 },
		DEFAULT_MAX_MESSAGE_BYTES,
	)
	const combined = new Uint8Array(first.byteLength + second.byteLength)
	combined.set(first, 0)
	combined.set(second, first.byteLength)
	const out = new FrameDecoder(DEFAULT_MAX_MESSAGE_BYTES).push(combined)
	assert(out.length === 2, `harus 2 pesan, dapat ${out.length}`)
	assert(sameJson(out[0], { type: 'ping', nonce: 1 }), 'pesan pertama salah')
	assert(
		sameJson(out[1], { type: 'pong', nonce: 2 }),
		'pesan kedua salah / terbalik',
	)
})

await run(
	'frame raksasa (prefix > max) → FrameError SEBELUM dialokasikan',
	() => {
		// Prefix mendeklarasikan 1000 byte padahal decoder dibatasi 16 byte.
		const evil = new Uint8Array(LENGTH_PREFIX_BYTES + 10)
		new DataView(evil.buffer).setUint32(0, 1000, false)
		let threw = false
		try {
			new FrameDecoder(16).push(evil)
		} catch (error) {
			threw = error instanceof FrameError
		}
		assert(threw, 'harus melempar FrameError untuk prefix di atas batas')
	},
)

await run('payload non-JSON → FrameError', () => {
	const junk = new TextEncoder().encode('ini bukan json {{{')
	const frame = new Uint8Array(LENGTH_PREFIX_BYTES + junk.byteLength)
	new DataView(frame.buffer).setUint32(0, junk.byteLength, false)
	frame.set(junk, LENGTH_PREFIX_BYTES)
	let threw = false
	try {
		new FrameDecoder(DEFAULT_MAX_MESSAGE_BYTES).push(frame)
	} catch (error) {
		threw = error instanceof FrameError
	}
	assert(threw, 'harus melempar FrameError untuk payload bukan JSON')
})

// ---------------------------------------------------------------------------
// GROUP 2 — parseMessage: fail-closed untuk bentuk rusak, menerima bentuk sah
// ---------------------------------------------------------------------------

console.log('GROUP 2 — parseMessage (fail-closed):')

const MALFORMED: Array<[string, unknown]> = [
	['null', null],
	['array []', []],
	['type tidak dikenal', { type: 'nope' }],
	['ping tanpa nonce', { type: 'ping' }],
	[
		'inv dengan hash bukan hex64',
		{ type: 'inv', kind: 'block', hashes: ['xyz'] },
	],
	[
		'getblocks dengan stopHash bukan hex64',
		{ type: 'getblocks', locator: [], stopHash: 'zz' },
	],
	['block tanpa payload', { type: 'block' }],
	['block dengan payload kosong', { type: 'block', payload: '' }],
	['block dengan payload bukan string', { type: 'block', payload: 42 }],
	[
		'block dengan payload bukan base64',
		{ type: 'block', payload: 'bukan base64!!' },
	],
	[
		'block dengan payload panjang bukan kelipatan 4',
		{ type: 'block', payload: 'AAA' },
	],
]
for (const [label, raw] of MALFORMED) {
	await run(`tolak: ${label}`, () => {
		assert(parseMessage(raw) === undefined, 'harus undefined, bukan pesan')
	})
}

await run('terima: version lengkap (semua field wajib)', () => {
	const parsed = parseMessage({
		type: 'version',
		protocolVersion: P2P_PROTOCOL_VERSION,
		chainId: 26,
		genesisHash: 'a'.repeat(64),
		bestHeight: 0,
		bestHash: 'b'.repeat(64),
	})
	assert(
		parsed !== undefined && parsed.type === 'version',
		'version sah harus diterima sebagai tipe version',
	)
})

await run('terima: getblocks locator kosong + stopHash 64 "0"', () => {
	const parsed = parseMessage({
		type: 'getblocks',
		locator: [],
		stopHash: '0'.repeat(64),
	})
	assert(
		parsed !== undefined && parsed.type === 'getblocks',
		'getblocks sah ditolak',
	)
})

await run('terima: inv dengan hash hex64', () => {
	const parsed = parseMessage({
		type: 'inv',
		kind: 'block',
		hashes: ['c'.repeat(64)],
	})
	assert(parsed !== undefined && parsed.type === 'inv', 'inv sah ditolak')
})

// ---------------------------------------------------------------------------
// GROUP 3 — MAX_INV_BATCH: batas batch inv/getdata ditegakkan
// ---------------------------------------------------------------------------

console.log('GROUP 3 — MAX_INV_BATCH:')

const hexHash = 'd'.repeat(64)
await run(
	`tolak: inv dengan MAX_INV_BATCH + 1 hash (${MAX_INV_BATCH + 1})`,
	() => {
		const hashes = Array.from({ length: MAX_INV_BATCH + 1 }, () => hexHash)
		assert(
			parseMessage({ type: 'inv', kind: 'block', hashes }) === undefined,
			'batch kelebihan harus ditolak',
		)
	},
)
await run(
	`terima: inv tx dengan tepat MAX_INV_BATCH hash (${MAX_INV_BATCH})`,
	() => {
		const hashes = Array.from(
			{ length: MAX_INV_BATCH },
			() => `${TX_HASH_PREFIX}${hexHash}`,
		)
		const parsed = parseMessage({ type: 'inv', kind: 'tx', hashes })
		assert(parsed !== undefined, 'batch penuh masih sah dan harus diterima')
	},
)

// ---------------------------------------------------------------------------
// GROUP 3b — bentuk hash tx (`TxC` + 64 hex) vs hash blok (64 hex)
// ---------------------------------------------------------------------------
//
// Inti regresi: `txHash` punya prefix `TxC` sehingga panjangnya 67, BUKAN 64.
// Kalau validasi `inv`/`getdata` kembali menyamakan kedua ruang hash, relay
// transaksi mati lagi secara senyap.

console.log('GROUP 3b — bentuk hash tx vs blok:')

const TX_HASH = `${TX_HASH_PREFIX}${'a'.repeat(64)}`
const BLOCK_HASH = 'b'.repeat(64)

await run('isTxHash: terima `TxC` + 64 hex (67 karakter)', () => {
	assert(isTxHash(TX_HASH) === true, 'bentuk sah ditolak')
	assert(TX_HASH.length === 67, `panjang harus 67, dapat ${TX_HASH.length}`)
})

await run('isTxHash: tolak 64 hex telanjang', () => {
	assert(isTxHash(BLOCK_HASH) === false, 'hash blok tidak boleh dianggap tx')
})

await run('isTxHash: tolak prefix/huruf/cacat yang salah', () => {
	assert(isTxHash(`TxC${'a'.repeat(63)}`) === false, 'kurang satu digit')
	assert(isTxHash(`TxC${'a'.repeat(65)}`) === false, 'kelebihan satu digit')
	assert(isTxHash(`txc${'a'.repeat(64)}`) === false, 'prefix huruf kecil')
	assert(isTxHash(`TxC${'A'.repeat(64)}`) === false, 'hex huruf besar')
	assert(isTxHash(`TxC${'g'.repeat(64)}`) === false, 'bukan hex')
	assert(isTxHash('') === false, 'string kosong')
	assert(isTxHash(undefined) === false, 'undefined')
	assert(isTxHash(123) === false, 'angka')
})

await run('terima: inv tx dengan hash `TxC…`', () => {
	const parsed = parseMessage({ type: 'inv', kind: 'tx', hashes: [TX_HASH] })
	assert(parsed !== undefined && parsed.type === 'inv', 'inv tx sah ditolak')
})

await run('terima: getdata tx dengan hash `TxC…`', () => {
	const parsed = parseMessage({
		type: 'getdata',
		items: [{ kind: 'tx', hash: TX_HASH }],
	})
	assert(
		parsed !== undefined && parsed.type === 'getdata',
		'getdata tx sah ditolak',
	)
})

await run('tolak: inv tx dengan 64 hex telanjang (bukan bentuk tx)', () => {
	assert(
		parseMessage({ type: 'inv', kind: 'tx', hashes: [BLOCK_HASH] }) ===
			undefined,
		'inv tx harus menuntut prefix `TxC`',
	)
})

await run('tolak: inv block dengan hash `TxC…` (bukan bentuk blok)', () => {
	assert(
		parseMessage({ type: 'inv', kind: 'block', hashes: [TX_HASH] }) ===
			undefined,
		'inv block harus menuntut 64 hex',
	)
})

await run('tolak: getdata block dengan hash `TxC…`', () => {
	assert(
		parseMessage({
			type: 'getdata',
			items: [{ kind: 'block', hash: TX_HASH }],
		}) === undefined,
		'getdata block harus menuntut 64 hex',
	)
})

await run('terima: getdata campuran (blok 64 hex + tx `TxC…`)', () => {
	const parsed = parseMessage({
		type: 'getdata',
		items: [
			{ kind: 'block', hash: BLOCK_HASH },
			{ kind: 'tx', hash: TX_HASH },
		],
	})
	assert(
		parsed !== undefined && parsed.type === 'getdata',
		'getdata campuran sah ditolak',
	)
})

// ---------------------------------------------------------------------------
// GROUP 4 — config: default aman + parsing env
// ---------------------------------------------------------------------------

console.log('GROUP 4 — loadP2PConfig / parsePeerList:')

await run('env kosong → default aman (mati, loopback, 30303, 10 MB)', () => {
	const config = loadP2PConfig({} as NodeJS.ProcessEnv)
	assert(config.enabled === false, 'P2P harus MATI tanpa env')
	assert(
		config.port === 30303,
		`port default harus 30303, dapat ${config.port}`,
	)
	assert(
		config.bindHost === '127.0.0.1',
		`bindHost harus 127.0.0.1, dapat ${config.bindHost}`,
	)
	assert(
		config.maxMessageBytes === DEFAULT_MAX_MESSAGE_BYTES,
		'maxMessageBytes harus DEFAULT_MAX_MESSAGE_BYTES',
	)
})

await run(
	'env terkonfigurasi: enabled on, port 1234, peer valid tersaring',
	() => {
		const config = loadP2PConfig({
			NEX_P2P_ENABLED: 'on',
			NEX_P2P_PORT: '1234',
			NEX_P2P_PEERS: '1.2.3.4:5, bad, 9.9.9.9:0',
		} as NodeJS.ProcessEnv)
		assert(config.enabled === true, 'NEX_P2P_ENABLED=on harus menyalakan P2P')
		assert(config.port === 1234, `port harus 1234, dapat ${config.port}`)
		assert(
			config.peers.length === 1,
			`hanya 1 peer valid, dapat ${config.peers.length}`,
		)
		assert(
			config.peers[0].host === '1.2.3.4' && config.peers[0].port === 5,
			`peer valid salah: ${JSON.stringify(config.peers[0])}`,
		)
	},
)

await run('parsePeerList("") → [] (bukan error, bukan peer kosong)', () => {
	assert(parsePeerList('').length === 0, 'string kosong harus menghasilkan []')
	assert(
		parsePeerList(undefined).length === 0,
		'undefined harus menghasilkan []',
	)
})

await run('syncTimeoutMs: default 60000, floor 1000', () => {
	const def = loadP2PConfig({} as NodeJS.ProcessEnv)
	assert(
		def.syncTimeoutMs === 60_000,
		`default harus 60000, dapat ${def.syncTimeoutMs}`,
	)
	const custom = loadP2PConfig({
		NEX_P2P_SYNC_TIMEOUT_MS: '5000',
	} as NodeJS.ProcessEnv)
	assert(
		custom.syncTimeoutMs === 5000,
		`nilai valid harus dipakai, dapat ${custom.syncTimeoutMs}`,
	)
	const tooLow = loadP2PConfig({
		NEX_P2P_SYNC_TIMEOUT_MS: '10',
	} as NodeJS.ProcessEnv)
	assert(
		tooLow.syncTimeoutMs === 60_000,
		`di bawah floor harus jatuh ke default 60000, dapat ${tooLow.syncTimeoutMs}`,
	)
})

await run(
	'serveChunkSize: default 32, env valid dipakai, tak sah → default',
	() => {
		const def = loadP2PConfig({} as NodeJS.ProcessEnv)
		assert(
			def.serveChunkSize === 32,
			`default harus 32, dapat ${def.serveChunkSize}`,
		)
		const custom = loadP2PConfig({
			NEX_P2P_SERVE_CHUNK: '8',
		} as NodeJS.ProcessEnv)
		assert(
			custom.serveChunkSize === 8,
			`nilai valid harus 8, dapat ${custom.serveChunkSize}`,
		)
		const zero = loadP2PConfig({
			NEX_P2P_SERVE_CHUNK: '0',
		} as NodeJS.ProcessEnv)
		assert(
			zero.serveChunkSize === 32,
			`0 harus jatuh ke default 32, dapat ${zero.serveChunkSize}`,
		)
	},
)

// ---------------------------------------------------------------------------
// GROUP 4b — tampilan bind: `0.0.0.0` → IPv4 LAN nyata
// ---------------------------------------------------------------------------

console.log('GROUP 4b — describeBindHost / pickLanIPv4:')

const fakeIfaces = (
	entries: Record<
		string,
		Array<{ address: string; family: string; internal: boolean }>
	>,
): ReturnType<typeof import('node:os').networkInterfaces> =>
	entries as unknown as ReturnType<typeof import('node:os').networkInterfaces>

await run(
	'pickLanIPv4: IPv4 non-internal pertama, lewati internal & IPv6',
	() => {
		const ifaces = fakeIfaces({
			lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
			eth0: [
				{ address: 'fe80::1', family: 'IPv6', internal: false },
				{ address: '192.168.1.5', family: 'IPv4', internal: false },
			],
		})
		assert(
			pickLanIPv4(ifaces) === '192.168.1.5',
			`harus 192.168.1.5, dapat ${pickLanIPv4(ifaces)}`,
		)
		assert(
			pickLanIPv4(fakeIfaces({})) === undefined,
			'tanpa antarmuka harus undefined',
		)
		assert(
			pickLanIPv4(
				fakeIfaces({
					lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
				}),
			) === undefined,
			'hanya loopback harus undefined',
		)
	},
)

await run(
	'describeBindHost: 0.0.0.0/:: → IP LAN, loopback/nama apa adanya, fallback',
	() => {
		const ifaces = fakeIfaces({
			eth0: [{ address: '192.168.1.5', family: 'IPv4', internal: false }],
		})
		assert(
			describeBindHost('0.0.0.0', ifaces) === '192.168.1.5',
			`0.0.0.0 harus jadi IP LAN, dapat ${describeBindHost('0.0.0.0', ifaces)}`,
		)
		assert(
			describeBindHost('::', ifaces) === '192.168.1.5',
			`:: harus jadi IP LAN, dapat ${describeBindHost('::', ifaces)}`,
		)
		assert(
			describeBindHost('127.0.0.1', ifaces) === '127.0.0.1',
			'loopback harus dibiarkan apa adanya',
		)
		assert(
			describeBindHost('0.0.0.0', fakeIfaces({})) === '0.0.0.0',
			'tanpa IPv4 LAN harus fallback ke nilai asli (jangan cetak kosong)',
		)
	},
)

// ---------------------------------------------------------------------------
// GROUP 5 — handshake: identitas jaringan & versi protokol
// ---------------------------------------------------------------------------

console.log('GROUP 5 — checkVersionMessage / buildVersionMessage:')

const EXPECTED = {
	chainId: 26,
	genesisHash: 'e'.repeat(64),
	protocolVersion: P2P_PROTOCOL_VERSION,
}
const goodVersion = buildVersionMessage({
	chainId: EXPECTED.chainId,
	genesisHash: EXPECTED.genesisHash,
	bestHeight: 3,
	bestHash: 'f'.repeat(64),
})

await run('genesis berbeda → tolak FATAL', () => {
	const check = checkVersionMessage(
		{ ...goodVersion, genesisHash: '0'.repeat(64) },
		EXPECTED,
	)
	assert(check.ok === false, 'genesis beda harus ditolak')
	assert(check.fatal === true, 'genesis beda harus FATAL (layak ban)')
})

await run('chain id berbeda → tolak FATAL', () => {
	const check = checkVersionMessage({ ...goodVersion, chainId: 999 }, EXPECTED)
	assert(check.ok === false, 'chain id beda harus ditolak')
	assert(check.fatal === true, 'chain id beda harus FATAL')
})

await run('protocolVersion berbeda → tolak FATAL', () => {
	const check = checkVersionMessage(
		{ ...goodVersion, protocolVersion: 999 },
		EXPECTED,
	)
	assert(check.ok === false, 'versi protokol beda harus ditolak')
	assert(check.fatal === true, 'versi protokol beda harus FATAL untuk v1')
})

await run('kecocokan persis → lolos, non-fatal', () => {
	const check = checkVersionMessage(goodVersion, EXPECTED)
	assert(check.ok === true, 'kecocokan persis harus lolos')
	assert(check.fatal === false, 'kecocokan persis bukan fatal')
})

await run(
	'buildVersionMessage mengecho chainId/genesis/bestHeight/bestHash',
	() => {
		const message = buildVersionMessage({
			chainId: 42,
			genesisHash: '1'.repeat(64),
			bestHeight: 17,
			bestHash: '2'.repeat(64),
		})
		assert(message.chainId === 42, 'chainId hilang/berubah')
		assert(message.genesisHash === '1'.repeat(64), 'genesisHash hilang/berubah')
		assert(message.bestHeight === 17, 'bestHeight hilang/berubah')
		assert(message.bestHash === '2'.repeat(64), 'bestHash hilang/berubah')
		assert(
			message.protocolVersion === P2P_PROTOCOL_VERSION,
			'versi protokol default harus P2P_PROTOCOL_VERSION',
		)
	},
)

await run('handshake state: lengkap hanya setelah keempat flag terisi', () => {
	const state = createHandshakeState()
	assert(isHandshakeComplete(state) === false, 'state awal belum lengkap')
	state.sentVersion = true
	state.receivedVersion = true
	state.sentVerack = true
	assert(
		isHandshakeComplete(state) === false,
		'tanpa receivedVerack belum lengkap',
	)
	state.receivedVerack = true
	assert(isHandshakeComplete(state) === true, 'keempat flag = lengkap')
})

// ---------------------------------------------------------------------------
// GROUP 6 — ban list: kedaluwarsa malas + lift
// ---------------------------------------------------------------------------

console.log('GROUP 6 — BanList:')

await run('ban 500ms pada t=1000: banned di 1400, kedaluwarsa di 1600', () => {
	const banned = new BanList(500)
	banned.ban('1.1.1.1', 'x', 1000)
	assert(
		banned.isBanned('1.1.1.1', 1400) === true,
		'harus masih banned di t=1400',
	)
	assert(
		banned.isBanned('1.1.1.1', 1600) === false,
		'harus kedaluwarsa di t=1600',
	)
	assert(
		banned.size(1600) === 0,
		'entri kedaluwarsa harus terbuang (prune malas)',
	)
})

await run('lift mengangkat larangan lebih awal', () => {
	const banned = new BanList(500)
	banned.ban('2.2.2.2', 'y', 1000)
	assert(banned.isBanned('2.2.2.2', 1100) === true, 'harus banned sebelum lift')
	banned.lift('2.2.2.2')
	assert(
		banned.isBanned('2.2.2.2', 1100) === false,
		'lift harus menghapus larangan',
	)
	assert(banned.size(1100) === 0, 'setelah lift list harus kosong')
})

await run('entries memuat alasan & waktu kedaluwarsa yang benar', () => {
	const banned = new BanList(500)
	banned.ban('3.3.3.3', 'PoW palsu', 1000)
	const entries = banned.entries(1200)
	assert(entries.length === 1, `harus 1 entri, dapat ${entries.length}`)
	assert(entries[0].address === '3.3.3.3', 'alamat entri salah')
	assert(entries[0].reason === 'PoW palsu', 'alasan entri salah')
	assert(
		entries[0].until === 1500,
		`until harus 1500, dapat ${entries[0].until}`,
	)
})

// ---------------------------------------------------------------------------
// GROUP 7 — broadcast gate: tekan ⇄ lepas, bersarang, melempar pun aman
// ---------------------------------------------------------------------------

console.log('GROUP 7 — broadcast gate:')

await run(
	'gate terbuka di luar, tertutup di dalam, terbuka lagi sesudahnya',
	async () => {
		assert(isBroadcastSuppressed() === false, 'gate harus terbuka di luar')
		const value = await runSuppressed(async () => {
			assert(
				isBroadcastSuppressed() === true,
				'gate harus tertutup di dalam runSuppressed',
			)
			return 'hasil'
		})
		assert(value === 'hasil', 'nilai balikan runSuppressed harus diteruskan')
		assert(
			isBroadcastSuppressed() === false,
			'gate harus terbuka lagi sesudah selesai',
		)
	},
)

await run(
	'bersarang + inner melempar: penghitung unwind dengan benar',
	async () => {
		let innerError: unknown
		await runSuppressed(async () => {
			assert(isBroadcastSuppressed() === true, 'lapisan luar: gate tertutup')
			try {
				await runSuppressed(async () => {
					assert(
						isBroadcastSuppressed() === true,
						'lapisan dalam: gate tetap tertutup',
					)
					throw new Error('inner')
				})
			} catch (error) {
				innerError = error
			}
			assert(
				innerError instanceof Error,
				'galat inner harus diteruskan ke luar',
			)
			assert(
				isBroadcastSuppressed() === true,
				'galat inner TIDAK boleh membuka gate luar',
			)
		})
		assert(
			isBroadcastSuppressed() === false,
			'gate harus terbuka setelah semua lapisan lepas',
		)
	},
)

// ---------------------------------------------------------------------------
// GROUP 8 — status sinkronisasi: gerbang IBD + latch
// ---------------------------------------------------------------------------
//
// Inti regresi: `nex_getWork` menolak saat `isSyncing()`. Bila modul ini keliru
// melaporkan "syncing", mining devnet mati; bila latch bocor, blok gossip
// menyalakan ulang gerbang. Keduanya dikunci di sini.

console.log('GROUP 8 — status sinkronisasi (gerbang IBD):')

await run(
	'default idle → isSyncing false (node tanpa P2P tak pernah ditahan)',
	() => {
		resetSyncState()
		assert(isSyncing() === false, 'default harus TIDAK syncing')
		const s = getSyncStatus()
		assert(s.phase === 'idle', `fase default harus idle, dapat ${s.phase}`)
		assert(s.syncing === false, 'syncing default harus false')
	},
)

await run('markSyncing → syncing true + meta tercatat', () => {
	resetSyncState()
	markSyncing({ localHeight: 3, targetHeight: 9 })
	assert(isSyncing() === true, 'harus syncing setelah markSyncing')
	const s = getSyncStatus()
	assert(s.phase === 'syncing', 'fase harus syncing')
	assert(
		s.localHeight === 3 && s.targetHeight === 9,
		`meta salah: ${JSON.stringify(s)}`,
	)
})

await run('markSynced → syncing false (mining dibuka)', () => {
	resetSyncState()
	markSyncing()
	markSynced({ localHeight: 10 })
	assert(isSyncing() === false, 'harus berhenti syncing setelah markSynced')
	assert(getSyncStatus().phase === 'synced', 'fase harus synced')
})

await run('latch: markSyncing setelah synced TIDAK menurunkan kembali', () => {
	resetSyncState()
	markSynced({ localHeight: 10 })
	markSyncing({ targetHeight: 99 })
	assert(isSyncing() === false, 'latch harus menahan di synced')
	const s = getSyncStatus()
	assert(s.phase === 'synced', 'fase tetap synced')
	assert(s.targetHeight === 99, 'meta tetap boleh diperbarui saat synced')
})

await run('markAssumed → mining dibuka tapi BUKAN latch', () => {
	resetSyncState()
	markSyncing()
	markAssumed({ localHeight: 7 })
	const assumed = getSyncStatus()
	assert(
		assumed.phase === 'assumed',
		`fase harus assumed, dapat ${assumed.phase}`,
	)
	assert(assumed.syncing === false, 'assumed harus membuka mining')
	// Berbeda dari synced: markSyncing boleh MENUTUP lagi gerbang.
	markSyncing({ targetHeight: 50 })
	assert(isSyncing() === true, 'assumed harus bisa diturunkan ke syncing')
	assert(getSyncStatus().phase === 'syncing', 'fase kembali syncing')
})

await run('latch synced LEBIH KUAT dari assumed', () => {
	resetSyncState()
	markAssumed()
	markSynced({ localHeight: 11 })
	markAssumed({ localHeight: 1 })
	assert(
		getSyncStatus().phase === 'synced',
		'assumed TIDAK boleh menurunkan synced (latch)',
	)
})

await run('resetSyncState → idle lagi', () => {
	markSynced()
	resetSyncState()
	assert(getSyncStatus().phase === 'idle', 'reset harus kembali idle')
	assert(isSyncing() === false, 'reset → tidak syncing')
})

// Fase `forked` (M2 — reorg): menahan mining selama tip diganti. Berbeda dari
// `synced`, ia SENGAJA menimpa fase apa pun; ditutup oleh `markSynced()`.

await run('markForked → menahan mining (isSyncing true)', () => {
	resetSyncState()
	markForked({ localHeight: 4 })
	const s = getSyncStatus()
	assert(s.phase === 'forked', `fase harus forked, dapat ${s.phase}`)
	assert(isSyncing() === true, 'forked harus menahan mining')
	assert(s.syncing === true, 'syncing flag harus true saat forked')
	assert(s.localHeight === 4, 'meta forked tercatat')
})

await run('markForked menimpa synced (bukan latch)', () => {
	resetSyncState()
	markSynced({ localHeight: 10 })
	markForked({ localHeight: 10 })
	assert(
		getSyncStatus().phase === 'forked',
		'forked harus menimpa synced — tip memang berubah',
	)
	assert(isSyncing() === true, 'forked harus menahan mining walau sudah synced')
})

await run('markForked selesai → markSynced membuka mining', () => {
	resetSyncState()
	markForked()
	markSynced({ localHeight: 6 })
	assert(getSyncStatus().phase === 'synced', 'setelah reorg harus synced')
	assert(isSyncing() === false, 'mining dibuka setelah reorg')
})

// ---------------------------------------------------------------------------
// GROUP 9 — observability peer: snapshot netral dipakai `nex_getPeerInfo`
// ---------------------------------------------------------------------------
//
// `src/core/events/peerState.ts` ditulis oleh `src/p2p/peers/peerManager.ts`
// dan dibaca oleh RPC. Karena core TIDAK boleh impor p2p (GROUP 10), modul ini
// harus mandiri; snapshot juga harus SALINAN agar pemanggil tak bisa memutasi
// state internal p2p.

console.log('GROUP 9 — observability peer (nex_getPeerInfo):')

await run('default: snapshot kosong (node tanpa peer)', () => {
	resetPeerState()
	const snap = getPeerStateSnapshot()
	assert(snap.count === 0, 'default count harus 0')
	assert(snap.peers.length === 0, 'default peers harus kosong')
	assert(snap.banned.length === 0, 'default ban harus kosong')
})

await run('updatePeers mencatat count + maxPeers + updatedAt', () => {
	resetPeerState()
	const peer: PeerInfo = {
		id: 'p1',
		remoteAddress: '127.0.0.1',
		remotePort: 30304,
		inbound: true,
		handshaked: true,
		connectedAt: 1000,
		lastSeenAt: 2000,
		status: {
			chainId: 26,
			genesisHash: 'a'.repeat(64),
			bestHeight: 7,
			bestHash: 'b'.repeat(64),
			listenPort: 30304,
		},
	}
	updatePeers([peer], 8)
	const snap = getPeerStateSnapshot()
	assert(snap.count === 1, `count harus 1, dapat ${snap.count}`)
	assert(snap.maxPeers === 8, `maxPeers harus 8, dapat ${snap.maxPeers}`)
	assert(snap.updatedAt > 0, 'updatedAt harus diisi')
	assert(snap.peers[0]?.status?.bestHeight === 7, 'status peer harus terbawa')
})

await run('snapshot adalah SALINAN (pemanggil tak bisa memutasi state)', () => {
	resetPeerState()
	updatePeers(
		[
			{
				id: 'p1',
				remoteAddress: '127.0.0.1',
				remotePort: 1,
				inbound: false,
				handshaked: true,
				connectedAt: 1,
				lastSeenAt: 1,
			},
		],
		4,
	)
	const a = getPeerStateSnapshot()
	a.peers.push({
		id: 'hack',
		remoteAddress: 'x',
		remotePort: 0,
		inbound: false,
		handshaked: false,
		connectedAt: 0,
		lastSeenAt: 0,
	})
	const b = getPeerStateSnapshot()
	assert(b.count === 1, 'mutasi salinan tidak boleh mengubah state internal')
})

await run('updateBans mencatat entri ban', () => {
	resetPeerState()
	updateBans([{ address: '10.0.0.9', reason: 'PoW palsu', until: 9_999 }])
	const snap = getPeerStateSnapshot()
	assert(snap.banned.length === 1, 'harus ada 1 entri ban')
	assert(snap.banned[0]?.reason === 'PoW palsu', 'alasan ban harus terbawa')
})

await run('resetPeerState mengosongkan semua', () => {
	updatePeers(
		[
			{
				id: 'p1',
				remoteAddress: '127.0.0.1',
				remotePort: 1,
				inbound: false,
				handshaked: true,
				connectedAt: 1,
				lastSeenAt: 1,
			},
		],
		4,
	)
	updateBans([{ address: '10.0.0.9', reason: 'x', until: 1 }])
	resetPeerState()
	const snap = getPeerStateSnapshot()
	assert(snap.count === 0 && snap.banned.length === 0, 'reset harus kosong')
	assert(snap.maxPeers === 0, 'reset harus mengosongkan maxPeers')
})

// ---------------------------------------------------------------------------
// GROUP 10 — arah dependensi: `src/core/**` TIDAK boleh mengimpor `src/p2p/**`
// ---------------------------------------------------------------------------
//
// Aturan arsitektur (lihat AGENTS.md & src/p2p/README.md): p2p adalah
// KONSUMEN core, bukan sebaliknya. Bila core mulai mengimpor p2p, kita dapat
// siklus impor dan core jadi tak bisa dipakai tanpa jaringan. Sebelumnya ini
// hanya konvensi; sekarang dijaga gerbang.

console.log('GROUP 10 — arah dependensi core → p2p:')

/** Semua berkas `.ts` di bawah sebuah direktori (rekursif). */
const listTsFiles = (dir: string): string[] => {
	const out: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			out.push(...listTsFiles(full))
			continue
		}
		if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
			out.push(full)
		}
	}
	return out
}

/**
 * Ekstrak specifier impor/ekspor statis dan `import()` dinamis dari sumber.
 * Komentar tidak boleh ikut — pemanggil menyaring lewat bentuk kutipan pada
 * klausa `from`, sehingga prosa seperti `` `src/p2p/` `` di komentar tidak
 * salah tertangkap.
 */
const importSpecifiers = (source: string): string[] => {
	const found: string[] = []
	const staticRe = /\bfrom\s+['"]([^'"]+)['"]/g
	const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
	for (const re of [staticRe, dynamicRe]) {
		let match: RegExpExecArray | null
		while ((match = re.exec(source)) !== null) found.push(match[1])
	}
	return found
}

/** `true` bila specifier menunjuk ke modul p2p (relatif atau alias `src/p2p`). */
const referencesP2P = (specifier: string): boolean => {
	const normalized = specifier.split('\\').join('/')
	if (normalized.startsWith('src/p2p')) return true
	// Relatif: `../p2p/...`, `./p2p`, `../../p2p/...` — cukup cek segmen `p2p`.
	return /(^|\/)p2p(\/|$)/.test(normalized.replace(/^\.+/, ''))
}

await run('src/core/** tidak mengimpor src/p2p/**', () => {
	const coreDir = join(process.cwd(), 'src', 'core')
	const offenders: string[] = []
	for (const file of listTsFiles(coreDir)) {
		const source = readFileSync(file, 'utf8')
		for (const specifier of importSpecifiers(source)) {
			if (referencesP2P(specifier)) {
				offenders.push(
					`${relative(process.cwd(), file).split(sep).join('/')} → ${specifier}`,
				)
			}
		}
	}
	assert(offenders.length === 0, `core mengimpor p2p: ${offenders.join(', ')}`)
})

await run('pemindai arah dependensi benar-benar bekerja (self-test)', () => {
	assert(
		referencesP2P('src/p2p/node') === true,
		'alias src/p2p harus terdeteksi',
	)
	assert(
		referencesP2P('../p2p/sync/syncManager.js') === true,
		'relatif harus terdeteksi',
	)
	assert(referencesP2P('src/core/events/syncState') === false, 'core BUKAN p2p')
	assert(referencesP2P('../../logging/logging') === false, 'logging BUKAN p2p')
	// Prosa dalam komentar tidak boleh memicu (tidak ada klausa `from`).
	assert(
		importSpecifiers('// lihat `src/p2p/README.md`\n').length === 0,
		'komentar tidak boleh dianggap impor',
	)
	assert(
		importSpecifiers("import { x } from 'src/p2p/chain'").length === 1,
		'impor statis harus terdeteksi',
	)
	assert(
		importSpecifiers("await import('src/p2p/chain')").length === 1,
		'import() dinamis harus terdeteksi',
	)
})

// ---------------------------------------------------------------------------
// GROUP 11 — pacing serve: `yieldToLoop` + `forEachChunked` (S5/T04)
// ---------------------------------------------------------------------------
//
// Node = satu proses; RPC/UI berbagi event loop dengan P2P. Loop layanan
// (`getblocks`/`getdata`/`inv`) yang panjang tanpa yield menahan `nex_getWork`
// dan timer. Helper ini yang memastikan giliran diserahkan tiap chunk.

console.log('GROUP 11 — pacing serve (yieldToLoop / forEachChunked):')

/** Fungsi tanpa efek — `visit`/`yieldFn` yang tidak relevan bagi tes. */
const noop = (): boolean => true
const noYield = async (): Promise<void> => {}

await run('yieldToLoop benar-benar menyerahkan batas makrotask', async () => {
	const order: string[] = []
	setImmediate(() => order.push('macro'))
	await yieldToLoop()
	order.push('after')
	assert(
		order[0] === 'macro',
		`setImmediate harus jalan lebih dulu, dapat ${JSON.stringify(order)}`,
	)
})

await run(
	'forEachChunked: urutan item dipertahankan, semua diproses',
	async () => {
		const seen: number[] = []
		await forEachChunked(
			[1, 2, 3, 4, 5],
			2,
			(n) => {
				seen.push(n)
				return true
			},
			noYield,
		)
		assert(
			sameJson(seen, [1, 2, 3, 4, 5]),
			`urutan salah: ${JSON.stringify(seen)}`,
		)
	},
)

await run(
	'forEachChunked: yield tepat DI ANTARA chunk, bukan setelah akhir',
	async () => {
		let yields = 0
		const counter = async (): Promise<void> => {
			yields++
		}
		await forEachChunked([1, 2, 3, 4, 5, 6], 2, noop, counter)
		assert(yields === 2, `6 item / chunk 2 → 2 yield, dapat ${yields}`)
		yields = 0
		await forEachChunked([1, 2, 3, 4], 2, noop, counter)
		assert(yields === 1, `4 item / chunk 2 → 1 yield, dapat ${yields}`)
		yields = 0
		await forEachChunked([1, 2], 5, noop, counter)
		assert(yields === 0, `2 item / chunk 5 → 0 yield, dapat ${yields}`)
	},
)

await run(
	'forEachChunked: chunkSize tak sah dijepit ke 1 (tetap ada yield)',
	async () => {
		let yields = 0
		const counter = async (): Promise<void> => {
			yields++
		}
		await forEachChunked([1, 2, 3], 0, noop, counter)
		assert(yields === 2, `chunkSize 0 → per-item (2 yield), dapat ${yields}`)
		yields = 0
		await forEachChunked([1, 2, 3], Number.NaN, noop, counter)
		assert(yields === 2, `chunkSize NaN → per-item (2 yield), dapat ${yields}`)
	},
)

await run('forEachChunked: daftar kosong → 0 visit, 0 yield', async () => {
	let visits = 0
	let yields = 0
	await forEachChunked(
		[],
		4,
		() => {
			visits++
			return true
		},
		async () => {
			yields++
		},
	)
	assert(
		visits === 0 && yields === 0,
		`kosong harus tanpa efek, dapat visit=${visits} yield=${yields}`,
	)
})

await run('forEachChunked: `visit` → false berhenti lebih awal', async () => {
	const seen: number[] = []
	await forEachChunked(
		[1, 2, 3, 4, 5],
		2,
		(n) => {
			seen.push(n)
			return n !== 3
		},
		noYield,
	)
	assert(
		sameJson(seen, [1, 2, 3]),
		`harus berhenti di 3, dapat ${JSON.stringify(seen)}`,
	)
})

// ---------------------------------------------------------------------------
// GROUP 12 — codec blok: round-trip RLP (O2/T06)
// ---------------------------------------------------------------------------
//
// Sejak protokol v2 badan blok dikirim sebagai `base64(rlp(block))`, bukan JSON
// mentah. Yang WAJIB terbukti di sini bukan sekadar "field sama", melainkan
// bahwa PREIMAGE HASH tidak berubah: identitas blok adalah
// `sha256(JSON.stringify(preimage) ‖ nonce)` (`prepareBlockForHashing`), jadi
// satu perbedaan kecil pun (nilai float, urutan key, `from`/`txHash` yang
// hilang) akan mengubah hash dan membuat blok ditolak `connectBlock`.
//
// Fixture: blok genesis NYATA (size float, metadata + extraData, coinbase
// extraData) dan blok ber-transaksi bertanda tangan asli (`from`/`txHash`
// ikut di preimage).

console.log('GROUP 12 — codec blok (encodeBlock / decodeBlock):')

const genesisBlock = buildGenesisBlock()

await run('terima: block dengan payload base64', () => {
	const parsed = parseMessage({ type: 'block', payload: '//8A' })
	assert(
		parsed !== undefined &&
			parsed.type === 'block' &&
			parsed.payload === '//8A',
		'payload base64 sah harus diterima',
	)
})

await run('round-trip genesis: preimage hash identik', () => {
	const before = prepareBlockForHashing(genesisBlock)
	const decoded = new Block(decodeBlock(encodeBlock(genesisBlock.block)))
	assert(
		before === prepareBlockForHashing(decoded),
		'preimage berubah → hash blok akan ditolak',
	)
})

await run('round-trip genesis: field di luar preimage ikut utuh', () => {
	const decoded = decodeBlock(encodeBlock(genesisBlock.block))
	assert(
		decoded.size === genesisBlock.block.size,
		`size float berubah: ${decoded.size} != ${genesisBlock.block.size}`,
	)
	// `metadata` TIDAK ikut preimage (lihat `prepareBlockForHashing`), jadi
	// urutan key-nya bebas dan pembuat blok pun berbeda urutan
	// (`genesis.ts` vs `createBlockTemplate.ts`). Yang harus utuh adalah
	// nilainya, bukan urutan key.
	const md = decoded.metadata
	const mdOriginal = genesisBlock.block.metadata
	assert(
		md !== undefined &&
			mdOriginal !== undefined &&
			md.txCount === mdOriginal.txCount &&
			md.created_at === mdOriginal.created_at &&
			md.extraData === mdOriginal.extraData,
		`metadata berubah: ${JSON.stringify(md)} != ${JSON.stringify(mdOriginal)}`,
	)
	// `verifyReward` membandingkan field ini dengan `!==`, jadi 0 harus tetap 0.
	assert(
		decoded.totalTransactionFees === genesisBlock.block.totalTransactionFees,
		`totalTransactionFees berubah: ${decoded.totalTransactionFees}`,
	)
	assert(
		decoded.header.hash === genesisBlock.block.header.hash,
		'header.hash berubah',
	)
})

await run('round-trip: difficulty pecahan tetap eksak (0.25 bit)', () => {
	// `clampDifficulty` mengkuantisasi difficulty ke kelipatan 0.25 bit, jadi
	// nilai pecahan seperti 21.5 SAH dan muncul di rantai nyata. Bug nyata
	// (ditemukan `p2p:fork`): encoding integer MENOLAK blok seperti itu dengan
	// "header.difficulty harus bilangan bulat aman >= 0", sehingga blok tak
	// pernah terkirim lewat P2P. Fixture integer saja tidak menangkap ini.
	const template = buildGenesisBlock().block
	for (const difficulty of [21.5, 21.25, 20.75, 8.5, 131_072]) {
		const block: blockStruct = {
			...template,
			header: { ...template.header, difficulty },
		}
		const decoded = decodeBlock(encodeBlock(block))
		assert(
			decoded.header.difficulty === difficulty,
			`difficulty ${difficulty} berubah jadi ${decoded.header.difficulty}`,
		)
		assert(
			prepareBlockForHashing(new Block(block)) ===
				prepareBlockForHashing(new Block(decoded)),
			`preimage berubah untuk difficulty ${difficulty}`,
		)
	}
})

await run('round-trip: metadata absen tetap absen', () => {
	// `metadata` opsional di Joi. Absen di-encode sebagai list RLP KOSONG
	// (0xc0), bukan tiga item berisi nol — itu yang membedakannya.
	const { metadata: _omitted, ...noMeta } = buildGenesisBlock().block
	const decoded = decodeBlock(encodeBlock(noMeta))
	assert(
		decoded.metadata === undefined,
		`metadata absen berubah jadi ada: ${JSON.stringify(decoded.metadata)}`,
	)
})

// Blok ber-transaksi: `transactions` ikut preimage, dan setiap tx wajib punya
// `from` (ecrecover) + `txHash` — keduanya TIDAK dikirim di wire.
await run(
	'round-trip blok ber-transaksi: preimage & tx turunan identik',
	() => {
		const { privateKey } = generateKeysFromMnemonic(
			'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
		)
		const input: comTxInterface = {
			amount: 1,
			format: 'NXC',
			receiver: `NxC${'22'.repeat(20)}`,
			sender: `NxC${'11'.repeat(20)}`,
			fee: 5000,
			data: stringToHex('p2p:check'),
		}
		const draft = createUnsignedTransaction(input, 0)
		assert(draft.status === true && draft.tx !== undefined, 'draft tx gagal')
		const signed = signTransaction(draft.tx!, privateKey)
		assert(signed.from !== undefined, 'from harus terisi hasil ecrecover')
		assert(signed.txHash !== undefined, 'txHash harus terhitung')
		// Kanonikalisasi lewat jalur node: transaksi yang BENAR-BENAR tersimpan di
		// blok selalu melewati `decodeTx`, yang menghitung `from`/`txHash` dan
		// menetapkan urutan key. Urutan itu ikut preimage, jadi fixture harus
		// menempuh jalur yang sama — bukan memakai keluaran `signTransaction`.
		const tx = decodeTx(encodeTx(signed))

		const template = buildGenesisBlock().block
		const block: blockStruct = {
			...template,
			height: 1,
			size: 12.5, // float sengaja: menguji jalur float64
			totalTransactionFees: tx.fee,
			merkleRoot: createMerkleRoot([tx]),
			blockReward: 0,
			totalReward: tx.fee,
			// Urutan `amount, receiver` = urutan kanonik pembuat blok.
			coinbaseTransaction: { amount: tx.fee, receiver: tx.from! },
			metadata: {
				txCount: 1,
				created_at: template.header.timestamp,
				extraData: stringToHex('p2p:check'),
			},
			transactions: [tx],
		}

		const decoded = decodeBlock(encodeBlock(block))
		assert(
			prepareBlockForHashing(new Block(block)) ===
				prepareBlockForHashing(new Block(decoded)),
			'preimage blok ber-transaksi berubah',
		)
		assert(
			sameJson(decoded.transactions, block.transactions),
			'transactions tidak round-trip (from/txHash hilang?)',
		)
	},
)

await run('tolak: payload base64 sah tetapi isinya bukan RLP blok', () => {
	let threw = false
	try {
		decodeBlock(uint8ToBase64(new Uint8Array([0xff, 0xff, 0x00])))
	} catch {
		threw = true
	}
	assert(threw, 'RLP rusak harus melempar')
})

await run('tolak: payload bukan base64 / kosong', () => {
	assertThrows(() => decodeBlock(''), 'payload kosong')
	assertThrows(() => decodeBlock('bukan base64!!'), 'payload bukan base64')
})

await run('tolak: RLP list blok dengan jumlah item salah', () => {
	// List kosong: sah secara RLP, salah secara skema blok.
	let threw = false
	try {
		decodeBlock(uint8ToBase64(new Uint8Array([0xc0])))
	} catch {
		threw = true
	}
	assert(threw, 'list blok kosong harus ditolak')
})

await run('base64: payload besar (1 MiB) tidak meledak & round-trip', () => {
	// Regresi: `String.fromCharCode(...data)` melempar RangeError pada payload
	// besar. Ini jalur yang O2 picu (blok RLP bisa ratusan KB).
	const big = new Uint8Array(1024 * 1024)
	for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff
	const encoded = uint8ToBase64(big)
	assert(encoded.length > 0, 'base64 kosong')
})

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exitCode = fail > 0 ? 1 : 0
