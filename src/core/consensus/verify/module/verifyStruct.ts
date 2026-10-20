import { Block } from 'src/core/block/blockModel'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { loggingErr } from '../../../../logging/errorLog'
import { MAX_SUPPLY_NEXU } from 'src/core/token/constants'
import {
	MAX_BLOCK_WIRE_BYTES,
	MAX_TX_PER_BLOCK,
} from 'src/core/consensus/blockLimits'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import Joi from 'joi'
import _ from 'lodash'

// Function to verify the structure of a block using Joi schema validation
//
// Setiap nilai moneter di sini berupa NEXU dan memakai aturan BAWAAN Joi
// (tanpa `.unsafe()`): bilangan bulat aman, bukan NaN/Infinity, dan tidak
// melebihi plafon suplai 50 juta NXC. `.unsafe(true)` yang dulu dipakai
// justru mematikan pertahanan itu tepat di lapisan yang memverifikasi
// rantai — satu-satunya tempat yang menolak blok sebelum ia menjadi
// bagian dari konsensus.
//
// ## Skema dibangun SEKALI (hoist, S4/T03)
//
// Dulu keempat `Joi.object({...})` dibangun DI DALAM `verifyStruct`, sehingga
// skema dikompilasi ulang untuk SETIAP blok yang diverifikasi. Karena
// `verifyChainIntegrity` menelusuri seluruh rantai, itu berarti ribuan
// kompilasi skema yang identik. Kini skema hidup di scope modul (dibangun
// sekali saat impor) dan `verifyStruct` hanya memanggil `.validate()`.

// Schema untuk transaksi di dalam blok (MemPoolInterface).
const txInterface = Joi.object({
	// `from` adalah hasil ecrecover, bukan field yang dikirim. Transaksi
	// di dalam blok selalu sudah melewati decode, jadi nilainya ada.
	from: Joi.string().required(),
	receiver: Joi.string().required(),
	amount: Joi.number().required().max(MAX_SUPPLY_NEXU),
	txHash: Joi.string().required(),
	sign: Joi.object({
		r: Joi.string().required(),
		s: Joi.string().required(),
		v: Joi.number().required(),
	}).required(),
	data: Joi.string().optional(),
	fee: Joi.number().required().min(0).max(MAX_SUPPLY_NEXU),
	nonce: Joi.number().integer().min(0).required(),
})

// Schema untuk objek coinbaseTransaction.
const coinbaseTransactionSchema = Joi.object({
	receiver: Joi.string().required(),
	// Jumlah yang benar-benar dikreditkan ke penambang — batas plafon
	// di sini adalah pengaman terakhir sebelum kredit masuk ke saldo.
	amount: Joi.number().required().max(MAX_SUPPLY_NEXU),
	extraData: Joi.any().optional(),
})

// Schema untuk objek metadata.
// (Field `gasPrice` DIHAPUS pada P2 bersama seluruh mekanisme gasPrice.)
// Joi default MENOLAK key tak dikenal → blok lama yang masih membawa
// `metadata.gasPrice` akan ditolak di sini — konsekuensi yang disengaja
// (reset rantai bagian dari P2).
const metadataSchema = Joi.object({
	// C1: jumlah harus bilangan bulat ≥ 0. Kesamaan dengan panjang
	// `transactions` TIDAK diperiksa di sini (di luar cakupan C1).
	txCount: Joi.number().integer().min(0).required(),
	created_at: Joi.number().required(),
	extraData: Joi.any().optional(), // Use .optional() if it's not required
})

// Schema untuk blockStruct.
const blockStructSchema = Joi.object({
	header: Joi.object({
		previousBlockHash: Joi.string().required(),
		timestamp: Joi.number().required(),
		hash: Joi.string().required(),
		nonce: Joi.number().required(),
		version: Joi.string().required(),
		difficulty: Joi.number().required(),
		hashingAlgorithm: Joi.string().optional(),
	}).required(),
	height: Joi.number().required(),
	chainId: Joi.number().required(),
	// C1: `size` = Σ byte wire transaksi pengguna (`encodeTxPayload`), coinbase
	// di luar — definisi yang SAMA dengan `MAX_BLOCK_WIRE_BYTES` dan dengan
	// yang dihitung `createBlockTemplate`. Di sini hanya plafon & bentuk
	// angkanya; KEBENARAN nilainya (harus sama dengan Σ tx-nya) dibuktikan di
	// `verifyStruct` setelah Joi — lihat catatan fungsi.
	size: Joi.number().integer().min(0).max(MAX_BLOCK_WIRE_BYTES).required(),
	totalTransactionFees: Joi.number().optional().min(0).max(MAX_SUPPLY_NEXU),
	merkleRoot: Joi.string().required(),
	minerId: Joi.string().required(),
	// totalReward = jumlah yang benar-benar dikreditkan ke coinbase
	// (blockReward + totalTransactionFees — tanpa gasPrice sejak P2).
	// Batas plafon di sini + batas yang sama di totalIssued (Stage 3)
	// memberi dua penegakan terpisah atas invariant yang sama.
	totalReward: Joi.number().required().min(0).max(MAX_SUPPLY_NEXU),
	status: Joi.valid('confirmed', 'pending').required(),
	// Dulu `Joi.any()` — menerima string apa pun, sehingga field yang
	// menentukan besaran pencetakan tidak diperiksa sama sekali.
	blockReward: Joi.number().required().min(0).max(MAX_SUPPLY_NEXU),
	coinbaseTransaction: coinbaseTransactionSchema.required(),
	metadata: metadataSchema.optional(), // Use .optional() if metadata is not required
	// C1: jumlah tx dibatasi konsensus (lihat `blockLimits`); cap di sini
	// menutup blok yang memaksa verifier memproses tx tak terhingga per byte.
	transactions: Joi.array().items(txInterface).max(MAX_TX_PER_BLOCK).required(),
	contract: Joi.any(),
})

export const verifyStruct = async (chains: Block) => {
	// Validate the block structure against the schema
	const { error } = blockStructSchema.validate(chains.block)
	if (error) {
		loggingErr({
			message: 'Invalid block structure',
			stack: new Error().stack!,
			timestamp: generateTimestampz(),
			level: 'error',
			priority: 'high',
			context: 'Block verifyStruct',
			hint: 'Invalid block structure',
		})
		return false // Structure is invalid
	}

	// C1: `size` BUKAN angka yang dipercaya — DIHITUNG ULANG dari himpunan
	// transaksi dan wajib sama persis (Σ `encodeTxPayload`). Tanpa ini blok
	// bisa ber-`size` palsu (mis. 0 atau jauh di bawah plafon) padahal
	// membawa tx sebesar apa pun. Genesis lolos otomatis: `size` 0 = Σ dari
	// daftar kosong. Gagal meng-encode = blok ditolak (fail-closed), bukan
	// verifier yang crash di tengah rantai.
	try {
		const computed = chains.block.transactions.reduce(
			(total, tx) => total + encodeTxPayload(tx).length,
			0,
		)
		if (computed !== chains.block.size) {
			loggingErr({
				message:
					`Invalid block size: header ${chains.block.size} != ` +
					`computed ${computed} (Σ byte wire tx)`,
				stack: new Error().stack!,
				timestamp: generateTimestampz(),
				level: 'error',
				priority: 'high',
				context: 'Block verifyStruct',
				hint: 'Blok menyatakan size yang tidak sesuai isinya (aturan konsensus C1) — blok ditolak.',
			})
			return false
		}
	} catch {
		loggingErr({
			message:
				'Invalid block size: transaksi gagal di-encode untuk perhitungan ukuran wire',
			stack: new Error().stack!,
			timestamp: generateTimestampz(),
			level: 'error',
			priority: 'high',
			context: 'Block verifyStruct',
			hint: 'Blok mengandung transaksi yang tidak bisa diukur (fail-closed) — blok ditolak.',
		})
		return false
	}
	return true
}
