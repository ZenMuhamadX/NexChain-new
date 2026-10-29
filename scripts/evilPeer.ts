import { EMPTY_STATE_ROOT } from 'src/core/state/root'
/// <reference types="bun-types" />
/**
 * Peer jahat P2P — harness OBSERVASI untuk lapisan `src/p2p/`.
 *
 * Jalankan:
 *   bun run scripts/evilPeer.ts -- <skenario> --host <h> --port <p>
 *
 * Delapan skenario, masing-masing menyoroti SATU pertahanan node:
 *
 *   1. bad-genesis    — kirim `version` dengan genesisHash jaringan lain.
 *                       Node wajib MENUTUP + MEM-BAN (identitas jaringan).
 *   2. bad-version    — kirim `version` dengan protocolVersion di luar versi
 *                       sekarang. Node wajib menutup + ban (tidak menawar
 *                       turun-versi).
 *   3. oversize       — frame dengan prefix panjang > `maxMessageBytes`.
 *                       Node wajib menutup SEBELUM payload dialokasikan.
 *   4. garbage        — payload frame bukan JSON valid.
 *                       Node wajib menutup (framing fail-closed).
 *   5. fake-pow-block — setelah handshake, kirim blok tiruan (clone genesis,
 *                       height 1, hash "f"×64). Node wajib menutup + ban
 *                       (pelanggaran konsensus = fatal).
 *   6. fork-block     — `inv` → `getdata` → balas blok yang PoW-nya SAH
 *                       tetapi `previousBlockHash` tidak menempel ke tip.
 *                       Node wajib MENOLAK TANPA memutus (penolakan non-
 *                       fatal — bukan pelanggaran).
 *   7. garbage-block  — pesan `block` dengan `payload` base64 SAH tetapi isi
 *                       RLP-nya bukan blok. Node wajib menutup + ban
 *                       (payload wire tidak bisa di-decode).
 *   8. coalesced      — `version` + `verack` dikirim dalam SATU tulis, tepat
 *                       menabrak jendela `await getLocalStatus()`. Node WAJIB
 *                       tetap membuka koneksi (dulu diputus "verack sebelum
 *                       version" — balapan urutan, bukan pelanggaran peer).
 *
 * Sifat observasi:
 *   - Skenario yang valid SELALU exit 0: skrip ini tidak memutuskan
 *     lulus/gagal, hanya melaporkan apa yang terlihat dari sisi klien
 *     (baris `status` dibaca sebagai informatif, bukan hasil gate).
 *   - Jendela pengamatan ~4 detik per skenario (plus handshake).
 *   - Node MEM-BAN alamat kita (`NEX_P2P_BAN_MS`, default 1 jam) setelah
 *     pelanggaran FATAL (skenario 1–5 dan 7). Karena itu jalankan SATU
 *     skenario per node segar — atau mulai dari `fork-block` yang tidak
 *     mem-ban.
 *   - Kegagalan sambung pun exit 0, tetapi dicetak keras sebagai
 *     PERHATIAN supaya tidak disalahartikan sebagai "pertahanan bekerja".
 *
 * Modul yang dipakai (`framing`, `handshake`, `config`) murni; blok tiruan
 * disusun lewat `prepareBlockForHashing` + `createPowHasher` yang sama
 * dipakai node, sehingga skenario 6 benar-benar lolos `verifyPow`.
 */
import {
	encodeFrame,
	FrameDecoder,
	LENGTH_PREFIX_BYTES,
} from 'src/p2p/transport/framing'
import { buildVersionMessage } from 'src/p2p/protocol/handshake'
import {
	P2P_PROTOCOL_VERSION,
	type P2PMessage,
} from 'src/p2p/protocol/messages'
import { DEFAULT_MAX_MESSAGE_BYTES } from 'src/p2p/config'
import {
	buildGenesisBlock,
	GENESIS_HASH,
	GENESIS_VERSION,
	GENESIS_HASHING_ALGORITHM,
	GENESIS_COINBASE_RECEIVER,
} from 'src/core/block/genesis'
import { CHAIN_ID } from 'src/crypto/chainId'
import { Block } from 'src/core/block/blockModel'
import type { blockStruct } from 'src/types/block'
import { prepareBlockForHashing } from 'src/core/block/prepareBlock'
import { createPowHasher } from 'src/core/consensus/Pow'
import { meetsDifficulty } from 'src/core/consensus/difficulty'
import { cutBlockReward } from 'src/core/block/distributeBlockReward'
import { createMerkleRoot } from 'src/core/transaction/utils/createMerkleRoot'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { encodeBlock } from 'src/core/encoding/hex/block/encodeBlock'
import { uint8ToBase64 } from 'src/core/encoding/hex/base64/uint8ToBase64'
import type { LocalChainStatus } from 'src/p2p/types'

// ---------------------------------------------------------------------------
// Tetapan waktu & batas
// ---------------------------------------------------------------------------

/** Jendela pengamatan sesudah aksi dikirim (ms). */
const OBSERVE_MS = 4000
/** Batas menunggu pesan handshake dari node (ms). */
const HANDSHAKE_WAIT_MS = 3000
/** Batas pencarian nonce fork-block — jauh di atas ekspektasi 2^16. */
const MAX_FORK_NONCE = 8_000_000
/**
 * Difficulty blok bercamang (bit). Node memverifikasi PoW terhadap
 * `header.difficulty` MILIK BLOK (retarget tidak dihitung ulang di jalur
 * P2P), jadi angka kecil membuat harness cepat tanpa mengorbankan
 * kesahihan: blok tetap benar-benar lolos `verifyPow` + `verifyBlockHash`.
 */
const FORK_DIFFICULTY_BITS = 16

// ---------------------------------------------------------------------------
// Utilitas kecil
// ---------------------------------------------------------------------------

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

/** Tunggu sampai `pred` benar atau `timeoutMs` lewat; balikkan hasil akhir. */
const waitFor = async (
	pred: () => boolean,
	timeoutMs: number,
): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (pred()) return true
		await delay(50)
	}
	return pred()
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

/** Status rantai yang dilaporkan ke node saat handshake. */
const localStatus = (genesisHash: string): LocalChainStatus => ({
	chainId: CHAIN_ID,
	genesisHash,
	bestHeight: 0,
	bestHash: genesisHash,
})

// ---------------------------------------------------------------------------
// Pengamat koneksi TCP
// ---------------------------------------------------------------------------

/**
 * Satu koneksi keluar ke node target.
 *
 * Membaca frame masuk lewat `FrameDecoder` yang sama dipakai node, lalu
 * mencatat TIPES pesan yang diterima (bukan isi — cukup untuk observasi)
 * beserta kapan dan mengapa koneksi ditutup.
 */
class EvilPeer {
	private socket: Bun.Socket<undefined> | undefined = undefined
	private readonly decoder = new FrameDecoder(DEFAULT_MAX_MESSAGE_BYTES)
	private closing = false
	private openedAt = 0

	/** Tipe pesan yang sudah kita kirim (untuk laporan). */
	readonly sent: string[] = []
	/** Tipe pesan yang diterima dari node. */
	readonly received: string[] = []
	connected = false
	connectError = ''
	closed = false
	closedByNode = false
	closedAfterMs = 0
	closeError = ''

	async connect(host: string, port: number): Promise<void> {
		try {
			this.socket = await Bun.connect<undefined>({
				hostname: host,
				port,
				socket: {
					open: () => {
						this.connected = true
						this.openedAt = Date.now()
					},
					data: (_socket, chunk) => this.feed(new Uint8Array(chunk)),
					close: (_socket, error) => this.onClose(error),
					error: (_socket, error) => this.onClose(error),
					connectError: (_socket, error) => {
						this.connectError = error.message
					},
				},
			})
			// `open` memang dipanggil lebih dulu, tetapi jangan bergantung
			// padanya bila runtime berubah urutan.
			this.connected = true
			if (this.openedAt === 0) this.openedAt = Date.now()
		} catch (error) {
			this.connectError = describe(error)
		}
	}

	/** Apakah pesan bertipe `type` sudah pernah diterima. */
	has(type: string): boolean {
		return this.received.includes(type)
	}

	send(message: P2PMessage): void {
		this.sent.push(message.type)
		if (!this.socket || this.closing) return
		try {
			this.socket.write(encodeFrame(message, DEFAULT_MAX_MESSAGE_BYTES))
		} catch {
			// socket sudah mati — biarkan laporan tutup yang bicara
		}
	}

	/** Kirim byte mentah (untuk frame raksasa / payload rusak). */
	sendRaw(bytes: Uint8Array, label: string): void {
		this.sent.push(label)
		if (!this.socket || this.closing) return
		try {
			this.socket.write(bytes)
		} catch {
			// socket sudah mati — abaikan
		}
	}

	/** Tutup dari sisi kita (bukan dihitung sebagai "node menutup"). */
	close(): void {
		this.closing = true
		if (!this.closed) {
			this.closed = true
			this.closedAfterMs = this.openedAt ? Date.now() - this.openedAt : 0
		}
		try {
			this.socket?.end()
		} catch {
			// socket sudah mati — abaikan
		}
	}

	private feed(chunk: Uint8Array): void {
		let messages: P2PMessage[]
		try {
			messages = this.decoder.push(chunk)
		} catch {
			// Node mengirim sesuatu yang tidak kami harapkan — bukan bagian
			// dari observasi, cukup abaikan.
			return
		}
		for (const message of messages) this.received.push(message.type)
	}

	private onClose(error?: Error): void {
		if (this.closed) return
		this.closed = true
		this.closedAfterMs = this.openedAt ? Date.now() - this.openedAt : 0
		if (error) this.closeError = error.message
		if (!this.closing) this.closedByNode = true
	}
}

// ---------------------------------------------------------------------------
// Penyusun blok uji
// ---------------------------------------------------------------------------

/**
 * Blok tiruan untuk skenario `fake-pow-block`.
 *
 * Clone struktur genesis dengan height 1 dan hash "f"×64: hash itu lolos
 * pemeriksaan panjang (64 hex) tetapi MUSTAHIL memenuhi difficulty, jadi
 * `verifyPow` gagal dan `connectBlock` menolaknya dengan `fatal=true`.
 */
const buildFakePowBlock = (): blockStruct => {
	const genesis = buildGenesisBlock()
	const struct: blockStruct = {
		...genesis.block,
		header: { ...genesis.block.header },
	}
	struct.height = 1
	struct.header.previousBlockHash = GENESIS_HASH
	struct.header.hash = 'f'.repeat(64)
	return struct
}

/**
 * Blok bercabang untuk skenario `fork-block`.
 *
 * Lolos SEMUA pemeriksaan konsensus (struktur, PoW, hash blok, merkle,
 * hadiah, timestamp) sehingga `connectBlock` sampai ke pemeriksaan khas
 * P2P — kaitan ke tip — dan di situ `previousBlockHash` yang sengaja salah
 * membuatnya ditolak dengan `fatal=false` (diamankan, koneksi tetap utuh).
 */
const buildForkBlock = (): Block => {
	const timestamp = Date.now()
	const reward = cutBlockReward(1)
	const miner = GENESIS_COINBASE_RECEIVER
	const struct: blockStruct = {
		header: {
			// BUKAN GENESIS_HASH — inilah "cabang" yang tidak menempel ke tip.
			previousBlockHash: '0'.repeat(63) + '1',
			timestamp,
			hash: '',
			nonce: 0,
			difficulty: FORK_DIFFICULTY_BITS,
			version: GENESIS_VERSION,
			hashingAlgorithm: GENESIS_HASHING_ALGORITHM,
			stateRoot: EMPTY_STATE_ROOT,
		},
		height: 1,
		size: 1,
		totalTransactionFees: 0,
		merkleRoot: createMerkleRoot([]),
		minerId: miner,
		chainId: CHAIN_ID,
		status: 'confirmed',
		blockReward: reward,
		totalReward: reward,
		coinbaseTransaction: {
			receiver: miner,
			amount: reward,
			extraData: stringToHex('fork-block'),
		},
		metadata: {
			txCount: 0,
			created_at: timestamp,
			extraData: stringToHex('fork-block'),
		},
		transactions: [],
	}

	const block = new Block(struct)
	// `prepareBlockForHashing` tidak memuat `nonce`/`hash`, jadi payload
	// sudah final sebelum nonce dicari — hash hasil pencarian dijamin sama
	// dengan yang dihitung ulang `verifyBlockHash`.
	const payload = prepareBlockForHashing(block)
	const hasher = createPowHasher(payload)
	for (let nonce = 0; nonce < MAX_FORK_NONCE; nonce++) {
		const hash = hasher.hash(nonce)
		if (meetsDifficulty(hash, FORK_DIFFICULTY_BITS)) {
			block.block.header.nonce = nonce
			block.block.header.hash = hash
			return block
		}
	}
	throw new Error(
		`fork-block: nonce tidak ditemukan dalam ${MAX_FORK_NONCE} percobaan`,
	)
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/**
 * Handshake lengkap dengan node: tunggu `version`-nya, kirim `version`
 * kita, tunggu `verack`-nya, lalu kirim `verack` kita.
 *
 * Urutan ini tidak lagi wajib (peer manager menandai `receivedVersion` secara
 * sinkron sebelum `await getLocalStatus()`), tetapi tetap dipakai supaya
 * skenario lain hanya berjalan setelah node benar-benar menganggap peer siap.
 * Skenario `coalesced` justru menguji kebalikannya: `version` + `verack` dalam
 * satu tulis.
 *
 * @returns `true` bila node menjawab `verack` (identitas jaringan cocok).
 */
const handshake = async (peer: EvilPeer): Promise<boolean> => {
	const sawVersion = await waitFor(() => peer.has('version'), HANDSHAKE_WAIT_MS)
	if (!sawVersion) return false
	peer.send(buildVersionMessage(localStatus(GENESIS_HASH)))
	const sawVerack = await waitFor(() => peer.has('verack'), HANDSHAKE_WAIT_MS)
	if (!sawVerack) return false
	peer.send({ type: 'verack' })
	// Beri node waktu memproses `verack` sampai menandai peer "siap".
	await delay(150)
	return true
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const SCENARIOS: string[] = [
	'bad-genesis',
	'bad-version',
	'oversize',
	'garbage',
	'fake-pow-block',
	'garbage-block',
	'fork-block',
	'coalesced',
]

interface Args {
	scenario: string
	host: string
	port: number
}

const printUsage = (): void => {
	console.log('Pemakaian:')
	console.log(
		'  bun run scripts/evilPeer.ts -- <skenario> --host <h> --port <p>',
	)
	console.log('')
	console.log('Skenario:')
	for (const name of SCENARIOS) console.log(`  ${name}`)
	console.log('')
	console.log('Contoh (P2P node dev):')
	console.log(
		'  bun run scripts/evilPeer.ts -- bad-genesis --host 127.0.0.1 --port 30303',
	)
	console.log('')
	console.log('Catatan: node mem-ban alamat kita setelah pelanggaran fatal,')
	console.log('         jadi jalankan SATU skenario per node segar.')
}

const parseArgs = (argv: string[]): Args | undefined => {
	// `bun run` bisa meneruskan pemisah `--` apa adanya — buang semua.
	const tokens = argv.filter((arg) => arg !== '--')
	let scenario = ''
	let host = '127.0.0.1'
	let port = 30303
	for (let i = 0; i < tokens.length; i++) {
		const arg = tokens[i]
		if (arg === '--host') {
			host = tokens[++i] ?? ''
		} else if (arg === '--port') {
			port = Number(tokens[++i])
		} else if (arg.startsWith('--host=')) {
			host = arg.slice('--host='.length)
		} else if (arg.startsWith('--port=')) {
			port = Number(arg.slice('--port='.length))
		} else if (arg.startsWith('-')) {
			return undefined
		} else if (scenario === '') {
			scenario = arg
		} else {
			return undefined
		}
	}
	if (
		scenario === '' ||
		!SCENARIOS.includes(scenario) ||
		host === '' ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65535
	) {
		return undefined
	}
	return { scenario, host, port }
}

// ---------------------------------------------------------------------------
// Pelaksanaan
// ---------------------------------------------------------------------------

/** Hash yang diumumkan pada `inv` skenario fork-block (tidak dimiliki node). */
const FORK_INV_HASH = 'd'.repeat(64)

const main = async (): Promise<void> => {
	const args = parseArgs(process.argv.slice(2))
	if (args === undefined) {
		printUsage()
		process.exit(1)
	}
	const { scenario, host, port } = args

	console.log('')
	console.log(`=== evilPeer — skenario "${scenario}" → ${host}:${port} ===`)
	console.log('')

	const peer = new EvilPeer()
	await peer.connect(host, port)

	if (!peer.connected) {
		console.log(
			`  PERHATIAN: gagal terhubung — ${peer.connectError || 'alasan tidak diketahui'}`,
		)
		console.log(
			'  (kemungkinan node / lapisan P2P tidak berjalan di host:port itu)',
		)
		console.log('')
		console.log('  status (informatif)  : TIDAK TERAMATI')
		console.log('')
		process.exit(0)
	}

	let expectClose = false
	let expectation = ''
	let note = ''

	try {
		switch (scenario) {
			case 'bad-genesis': {
				await waitFor(() => peer.has('version'), HANDSHAKE_WAIT_MS)
				peer.send(buildVersionMessage(localStatus('0'.repeat(64))))
				expectClose = true
				expectation = 'menutup + mem-ban (genesis bukan jaringan ini)'
				break
			}
			case 'bad-version': {
				await waitFor(() => peer.has('version'), HANDSHAKE_WAIT_MS)
				peer.send(
					buildVersionMessage(
						localStatus(GENESIS_HASH),
						P2P_PROTOCOL_VERSION + 1,
					),
				)
				expectClose = true
				expectation = 'menutup + mem-ban (protokol v1 tidak bernegosiasi)'
				break
			}
			case 'oversize': {
				await waitFor(() => peer.has('version'), HANDSHAKE_WAIT_MS)
				const frame = new Uint8Array(LENGTH_PREFIX_BYTES + 8)
				new DataView(frame.buffer).setUint32(
					0,
					DEFAULT_MAX_MESSAGE_BYTES + 1,
					false,
				)
				peer.sendRaw(frame, 'frame raksasa (prefix > 10 MB)')
				expectClose = true
				expectation = 'menutup sebelum payload dialokasikan (FrameError)'
				break
			}
			case 'garbage': {
				await waitFor(() => peer.has('version'), HANDSHAKE_WAIT_MS)
				const junk = new TextEncoder().encode('bukan-json {{{')
				const frame = new Uint8Array(LENGTH_PREFIX_BYTES + junk.byteLength)
				new DataView(frame.buffer).setUint32(0, junk.byteLength, false)
				frame.set(junk, LENGTH_PREFIX_BYTES)
				peer.sendRaw(frame, 'payload bukan JSON')
				expectClose = true
				expectation = 'menutup (framing fail-closed)'
				break
			}
			case 'fake-pow-block': {
				if (await handshake(peer)) {
					peer.send({
						type: 'block',
						payload: encodeBlock(buildFakePowBlock()),
					})
				} else {
					note = 'handshake gagal — observasi tidak representatif'
				}
				expectClose = true
				expectation = 'menutup + mem-ban (PoW blok tiruan tidak valid)'
				break
			}
			case 'garbage-block': {
				if (await handshake(peer)) {
					// Base64 SAH (lolos `parseMessage`) tetapi byte-nya bukan
					// RLP blok — menguji jalur "payload tidak bisa di-decode".
					const junk = uint8ToBase64(new Uint8Array([0xff, 0xff, 0x00]))
					peer.send({ type: 'block', payload: junk })
				} else {
					note = 'handshake gagal — observasi tidak representatif'
				}
				expectClose = true
				expectation = 'menutup + mem-ban (payload blok tidak bisa di-decode)'
				break
			}
			case 'fork-block': {
				if (await handshake(peer)) {
					peer.send({
						type: 'inv',
						kind: 'block',
						hashes: [FORK_INV_HASH],
					})
					const sawGetData = await waitFor(
						() => peer.has('getdata'),
						HANDSHAKE_WAIT_MS,
					)
					if (sawGetData) {
						peer.send({
							type: 'block',
							payload: encodeBlock(buildForkBlock().block),
						})
					} else {
						note = 'node tidak menjawab getdata — observasi terbatas'
					}
				} else {
					note = 'handshake gagal — observasi tidak representatif'
				}
				expectClose = false
				expectation = 'TIDAK menutup (cabang ditolak tanpa ban)'
				break
			}
			case 'coalesced': {
				// Balapan yang pernah memutus peer sehat: `version` diproses di
				// belakang `await getLocalStatus()`, jadi `verack` yang tiba
				// sebelum flag itu diset dianggap pelanggaran. Kedua frame
				// dikirim dalam SATU write supaya keduanya pasti diproses pada
				// giliran yang sama.
				await waitFor(() => peer.has('version'), HANDSHAKE_WAIT_MS)
				const version = encodeFrame(
					buildVersionMessage(localStatus(GENESIS_HASH)),
					DEFAULT_MAX_MESSAGE_BYTES,
				)
				const verack = encodeFrame(
					{ type: 'verack' },
					DEFAULT_MAX_MESSAGE_BYTES,
				)
				const both = new Uint8Array(version.byteLength + verack.byteLength)
				both.set(version, 0)
				both.set(verack, version.byteLength)
				peer.sendRaw(both, 'version+verack (satu write)')
				expectClose = false
				expectation = 'TIDAK menutup (urutan frame dalam satu write sah)'
				break
			}
			default:
				break
		}
	} catch (error) {
		note = `gagal menyusun/mengirim aksi: ${describe(error)}`
	}

	// Jendela pengamatan: berhenti lebih awal bila node sudah menutup.
	if (expectClose) {
		await waitFor(() => peer.closedByNode, OBSERVE_MS)
	} else {
		await delay(OBSERVE_MS)
	}

	console.log('  observasi:')
	console.log(`    terhubung           : ${peer.connected ? 'ya' : 'tidak'}`)
	console.log(
		`    kirim ke node       : ${peer.sent.join(', ') || '(tidak ada)'}`,
	)
	console.log(
		`    terima dari node    : ${peer.received.join(', ') || '(tidak ada)'}`,
	)
	if (peer.closedByNode) {
		console.log(
			`    node menutup        : ya (setelah ${peer.closedAfterMs} ms)`,
		)
	} else if (peer.closed) {
		console.log('    node menutup        : tidak (kita yang menutup)')
	} else {
		console.log(`    node menutup        : tidak (jendela ${OBSERVE_MS} ms)`)
	}
	if (peer.closeError !== '') {
		console.log(`    galat saat tutup    : ${peer.closeError}`)
	}
	if (note !== '') {
		console.log(`    catatan             : ${note}`)
	}
	console.log('')
	console.log(`  ekspektasi           : ${expectation}`)
	const matched = expectClose ? peer.closedByNode : !peer.closed
	console.log(`  status (informatif)  : ${matched ? 'SESUAI' : 'TIDAK SESUAI'}`)
	console.log('')
	console.log('  catatan: harness observasi — keluaran SELALU exit 0.')
	console.log('')

	peer.close()
	await delay(50)
	// Socket menahan event loop; paksa keluar supaya `bun run` segera berakhir.
	process.exit(0)
}

main().catch((error: unknown) => {
	console.error(`\ngagal: ${describe(error)}`)
	process.exit(1)
})
