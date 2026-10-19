import { TxInterface } from 'src/types/transaction'
import { Block } from 'src/core/block/blockModel'
import { getCurrentBlock } from './query/onChain/block/getCurrentBlock'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { createMerkleRoot } from 'src/core/transaction/utils/createMerkleRoot'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { calculateTotalFees } from 'src/core/transaction/utils/totalFees'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { calculateTotalBlockReward } from 'src/core/consensus/calculateReward'
import { expectedDifficulty } from 'src/core/consensus/difficulty'
import { cutBlockReward } from 'src/core/block/distributeBlockReward'
import {
	getPreviousTimestamps,
	MTP_WINDOW,
	medianTimePast,
} from 'src/core/consensus/verify/module/verifyTimestamp'
import { resolveBlock } from 'src/core/consensus/reorg/ancestry'
import { CHAIN_ID } from 'src/crypto/chainId'

/**
 * Timestamp kronologis (tua→baru) dari `parent` dan leluhurnya, maksimal
 * `MTP_WINDOW` — dipakai saat membangun blok di atas induk NON-tip (cabang).
 * Menelusuri `previousBlockHash` (pool-aware) supaya jendela MTP benar walau
 * sebagian leluhur masih di branch pool.
 */
const collectAncestorTimestamps = async (parent: Block): Promise<number[]> => {
	const out: number[] = []
	let current: Block | undefined = parent
	let count = 0
	while (current !== undefined && count < MTP_WINDOW) {
		out.push(current.block.header.timestamp)
		count++
		const prev: string = current.block.header.previousBlockHash
		current = prev ? await resolveBlock(prev) : undefined
	}
	return out.reverse()
}

/**
 * Susun **template blok** berikutnya: field konten lengkap (tinggi, hadiah,
 * coinbase, merkle root, difficulty retarget) tetapi TANPA PoW — solusi PoW
 * baru diisi node saat `nex_submitWork` diterima (lihat
 * `nexchain/miner/work.ts`), karena hanya itu yang belum diketahui saat
 * template dibuat. `size` TIDAK termasuk yang ditunda: ia murni properti
 * himpunan transaksi, jadi sudah final di sini.
 *
 * Blok produksi TIDAK ditandatangani siapa pun (standar PoW Bitcoin):
 * keamanan dari PoW + hash chain + merkle + validasi penuh. Satu-satunya
 * tanda tangan di rantai adalah per-transaksi, oleh pengirimnya.
 *
 * Pemisahan inilah yang membuat node tidak pernah menjalankan loop PoW:
 * template dikirim ke miner eksternal sebagai `payload`
 * (= `prepareBlockForHashing(template)`), miner mencari nonce, node
 * memverifikasi ulang dan menyelesaikan blok.
 *
 * Difficulty dihitung deterministik dari data rantai lewat `expectedDifficulty`
 * (target blok 60 detik) — menggantikan retarget berbasis jam dinding dan
 * `difficulty: 5` hardcode lama.
 *
 * @param transactions transaksi pengguna yang akan dimasukkan
 * @param walletMiner  alamat penerima hadiah (== coinbase receiver)
 * @param parent       opsional — paksa induk blok. Bila diisi, template
 *                     dibangun di atas blok ini (bukan tip lokal) dan jendela
 *                     MTP ditelusuri dari rantai nenek moyang `parent`.
 *                     Dipakai untuk membangun CABANG bersaing di gate reorg;
 *                     jalur produksi (mining) tidak mengisinya.
 */
export const createBlockTemplate = async (
	transactions: TxInterface[],
	walletMiner: string,
	parent?: Block,
): Promise<Block> => {
	const latestBlock = parent ?? ((await getCurrentBlock()) as Block)
	if (!latestBlock) {
		throw new Error('Latest block is undefined.')
	}

	const height = latestBlock.block.height + 1

	// Timestamp harus LEBIH BESAR dari median-time-past 11 blok sebelumnya
	// (aturan konsensus `checkBlockTimestamp`) — kalau tidak, blok yang
	// disusun node ini akan DITOLAK oleh commitBlock/verifyIntegrity saat
	// kembali. Mining cepat di dev (beberapa blok per detik) membuat
	// `Date.now()` bisa sama dengan atau lebih kecil dari tip; dalam kasus
	// itu pakai `mtp + 1` sehingga setiap template tervalidasi MTP
	// **oleh konstruksi**.
	const now = generateTimestampz()
	const previousTimestamps =
		parent === undefined
			? await getPreviousTimestamps(height)
			: await collectAncestorTimestamps(parent)
	const mtp = medianTimePast(previousTimestamps)
	const timestamp = now > mtp ? now : mtp + 1

	// Hadiah blok + fee (fee dihitung dari transaksi pengguna; coinbase fee 0
	// sehingga tidak perlu dihitung dua kali). Tidak ada suku gasPrice lagi
	// sejak P2 — satu-satunya pendapatan miner = hadiah + fee.
	const blockReward = cutBlockReward(height)
	const totalTransactionFees = calculateTotalFees(transactions)
	const totalReward = calculateTotalBlockReward(
		blockReward,
		totalTransactionFees,
	)

	// Coinbase BUKAN transaksi. Hadiah ditangani protokol — `processTransact`
	// mengkreditnya SEBELUM transaksi blok diproses — dan ter-commit lewat
	// `minerId` + `totalReward` + `coinbaseTransaction` di preimage PoW,
	// bukan lagi secara insidental lewat pseudo-tx di daftar transaksi.
	// Difficulty dihitung DETERMINISTIK dari data rantai setelah `timestamp`
	// ditetapkan: `expectedDifficulty(parent.difficulty, parent.timestamp,
	// timestamp, parent.height)`. Validator menghitung ulang rumus yang sama
	// dan MENOLAK blok bila `header.difficulty` berbeda — jadi template ini
	// tervalidasi oleh konstruksi (lihat `verifyTimestamp` untuk batas gap).
	const difficulty = expectedDifficulty(
		latestBlock.block.header.difficulty,
		latestBlock.block.header.timestamp,
		timestamp,
		latestBlock.block.height,
	)

	return new Block({
		header: {
			difficulty,
			hash: '',
			nonce: 0,
			previousBlockHash: latestBlock.block.header.hash,
			timestamp,
			version: '1.0.0',
			hashingAlgorithm: 'SHA256',
		},
		height,
		// `size` = Σ byte wire transaksi PENGGUNA (`encodeTxPayload`) — satuan
		// dan himpunan yang SAMA dengan anggaran `MAX_BLOCK_WIRE_BYTES`, jadi
		// `size ≤ MAX_BLOCK_WIRE_BYTES` berlaku by construction. Coinbase di
		// luar (bukan tx di `transactions`). Tidak ikut preimage PoW, jadi
		// tidak mengubah hash blok.
		size: transactions.reduce((n, tx) => n + encodeTxPayload(tx).length, 0),
		totalTransactionFees,
		merkleRoot: createMerkleRoot(transactions),
		// minerId = alamat wallet penerima hadiah (== coinbase receiver),
		// mengganti hash(IPv4+timestamp) lama yang tidak bisa diverifikasi.
		minerId: walletMiner,
		status: 'confirmed',
		blockReward,
		totalReward,
		coinbaseTransaction: {
			amount: totalReward,
			receiver: walletMiner,
			extraData: stringToHex('Block reward'),
		},
		metadata: {
			extraData: stringToHex('BlockChains by NexChain'),
			txCount: transactions.length,
			created_at: timestamp,
		},
		transactions,
		chainId: CHAIN_ID,
	})
}
