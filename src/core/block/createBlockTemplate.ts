import { TxInterface } from 'src/types/transaction'
import { Block } from 'src/core/block/blockModel'
import { getCurrentBlock } from './query/onChain/block/getCurrentBlock'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { createMerkleRoot } from 'src/core/transaction/utils/createMerkleRoot'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { calculateTotalFees } from 'src/core/transaction/utils/totalFees'
import { calculateTotalBlockReward } from 'src/core/consensus/calculateReward'
import { clampDifficulty, retargetByTime } from 'src/core/consensus/difficulty'
import { cutBlockReward } from 'src/core/block/distributeBlockReward'
import {
	getPreviousTimestamps,
	medianTimePast,
} from 'src/core/consensus/verify/module/verifyTimestamp'
import { CHAIN_ID } from 'src/crypto/chainId'

/**
 * Susun **template blok** berikutnya: field konten lengkap (tinggi, hadiah,
 * coinbase, merkle root, difficulty retarget) tetapi TANPA PoW dan TANPA
 * size — keduanya diisi node saat `nex_submitWork` diterima (lihat
 * `nexchain/miner/work.ts`), karena hanya solusi PoW yang belum diketahui
 * saat template dibuat.
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
 * Difficulty memakai retarget adaptif target 60 detik (lihat
 * `nexchain/miner/difficulty`) — mengganti `difficulty: 5` hardcode lama.
 */
export const createBlockTemplate = async (
	transactions: TxInterface[],
	walletMiner: string,
): Promise<Block> => {
	const latestBlock = (await getCurrentBlock('json')) as Block
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
	const previousTimestamps = await getPreviousTimestamps(height)
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
	const difficulty = nextDifficulty(latestBlock)

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
		size: 0,
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

/**
 * Retarget difficulty: berbasis WAKTU sejak tip hingga template dibuat —
 * `now - tip.timestamp` (bukan jarak tip vs orangtuanya).
 *
 * Mengapa jarak grandparent→tip (lama) menyebabkan bug: nilai itu hanya
 * mencerminkan interval DUA blok LAMAU. Saat rantai idle (job terus
 * kadaluarsa, blok tak pernah diselesaikan) angkanya tetap ~target (30 detik
 * kala itu),
 * sehingga difficulty mandek (mis. 27.5) dan tidak pernah turun — persis
 * gejala "expiry berturut-turut tanpa penurunan". `now - tip.timestamp`
 * mengukur umur tip: idle time ikut terhitung → actualMs tumbuh → difficulty
 * turun.
 *
 * - Tip genesis (`height <= 0`): jarak waktu belum terdefinisi → pertahankan
 *   difficulty tip (dibatasi [MIN, MAX]) — perilaku lama dipertahankan;
 * - selain itu `retargetByTime` menghitung koreksi log2 terhadap
 *   `TARGET_BLOCK_TIME_MS` (kini 60 detik), dibatasi asimetris (naik maks +2,
 *   turun maks -4), dikunci [MIN, MAX] dan dikuantisasi 0.25 bit.
 *
 * Catatan: `retargetByTime` dibatasi turun maks -4 PER PEMANGGILAN dari
 * `tip.difficulty`. Selama tip tidak bergerak (blok tak ter-commit) penurunan
 * dari template saja bisa mandek di `tip - 4`. Untuk itulah jalur expiry
 * `cleanupExpiredJobs` (basis kumulatif dari job expired) melengkapi ini
 * hingga benar-benar menyentuh floor — lihat `nexchain/miner/work.ts`.
 *
 * Data lama ber-skema lama (difficulty angka kecil) otomatis naik bertahap
 * ke rentang normal lewat clamp — tanpa syarat khusus "blok lama".
 */
const nextDifficulty = (tip: Block): number => {
	const parentBits = tip.block.header.difficulty
	if (tip.block.height <= 0) return clampDifficulty(parentBits)
	return retargetByTime(parentBits, tip.block.header.timestamp)
}
