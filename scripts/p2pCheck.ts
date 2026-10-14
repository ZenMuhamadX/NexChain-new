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
 *   9. **Arah dependensi** — `src/core/**` TIDAK boleh mengimpor `src/p2p/**`
 *      (p2p adalah konsumen core, bukan sebaliknya).
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
} from 'src/p2p/config'
import {
	buildVersionMessage,
	checkVersionMessage,
	createHandshakeState,
	isHandshakeComplete,
} from 'src/p2p/protocol/handshake'
import { runSuppressed, isBroadcastSuppressed } from 'src/p2p/broadcastGate'
import { BanList } from 'src/p2p/peers/banList'
import { isTxHash, TX_HASH_PREFIX } from 'src/core/encoding/rlp/txHash'
import {
	getSyncStatus,
	isSyncing,
	markAssumed,
	markSynced,
	markSyncing,
	resetSyncState,
} from 'src/core/events/syncState'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { P2PMessage } from 'src/p2p/protocol/messages'

let pass = 0
let fail = 0

/** Tolak bila `cond` palsu — setiap pemeriksaan adalah fungsi kecil. */
const assert = (cond: boolean, message: string): void => {
	if (!cond) throw new Error(message)
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
	['block dengan block null', { type: 'block', block: null }],
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

// ---------------------------------------------------------------------------
// GROUP 9 — arah dependensi: `src/core/**` TIDAK boleh mengimpor `src/p2p/**`
// ---------------------------------------------------------------------------
//
// Aturan arsitektur (lihat AGENTS.md & src/p2p/README.md): p2p adalah
// KONSUMEN core, bukan sebaliknya. Bila core mulai mengimpor p2p, kita dapat
// siklus impor dan core jadi tak bisa dipakai tanpa jaringan. Sebelumnya ini
// hanya konvensi; sekarang dijaga gerbang.

console.log('GROUP 9 — arah dependensi core → p2p:')

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

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exitCode = fail > 0 ? 1 : 0
