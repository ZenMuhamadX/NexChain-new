import { TxInterface } from 'interface/structTx'
import { Block } from 'nexchain/model/block/block'
import { getCurrentBlock } from './query/onChain/block/getCurrentBlock'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { createMerkleRoot } from 'nexchain/transaction/utils/createMerkleRoot'
import { createCoinbaseTx } from 'nexchain/transaction/coinbase'
import { stringToHex } from 'nexchain/hex/stringToHex'
import { calculateTotalFees } from 'nexchain/transaction/utils/totalFees'
import { calculateTotalBlockReward } from 'nexchain/miner/calculateReward'
import { clampDifficulty, retargetByTime } from 'nexchain/miner/difficulty'
import { toNexu } from 'nexchain/nexucoin/toNexu'
import { cutBlockReward } from './cutReward'
import { CHAIN_ID } from 'sign/chainId'

/**
 * Susun **template blok** berikutnya: field konten lengkap (tinggi, hadiah,
 * coinbase, merkle root, difficulty retarget) tetapi TANPA PoW, TANPA
 * signature, dan TANPA size — ketiganya diisi node saat `nex_submitWork`
 * diterima (lihat `nexchain/miner/work.ts`), karena hanya solusi PoW yang
 * belum diketahui saat template dibuat.
 *
 * Pemisahan inilah yang membuat node tidak pernah menjalankan loop PoW:
 * template dikirim ke miner eksternal sebagai `payload`
 * (= `prepareBlockForHashing(template)`), miner mencari nonce, node
 * memverifikasi ulang dan menyelesaikan blok.
 *
 * Difficulty memakai retarget adaptif target 30 detik (lihat
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

	// Tandai transaksi mempool sebagai terkonfirmasi SEBELUM masuk blok
	// (flag ini ikut masuk preimage PoW dan divalidasi verifyStruct).
	// Pemanggilan loop lama di mining.ts dipindahkan ke sini supaya satu
	// transaksi yang lolos ke blok selalu berstatus konsisten.
	for (const tx of transactions) {
		tx.isValid = true
		tx.isPending = false
		tx.status = 'confirmed'
	}

	const height = latestBlock.block.height + 1
	const timestamp = generateTimestampz()

	// Hadiah blok + fee (fee dihitung dari transaksi pengguna; coinbase fee 0
	// sehingga tidak perlu dihitung dua kali).
	const blockReward = cutBlockReward(height)
	const gasPrice = toNexu(0.00025)
	const totalTransactionFees = calculateTotalFees(transactions)
	const totalReward = calculateTotalBlockReward(
		blockReward,
		gasPrice,
		totalTransactionFees,
	)

	// Coinbase PERTAMA dalam daftar: hadiah ikut ter-commit di merkleRoot &
	// preimage PoW, dan kredit penambang terproses sebelum transaksi lain di
	// blok yang sama (boleh membelanjakan hadiahnya langsung).
	const coinbaseTx = createCoinbaseTx(walletMiner, totalReward, timestamp)
	const allTransactions: TxInterface[] = [coinbaseTx, ...transactions]

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
		merkleRoot: createMerkleRoot(allTransactions),
		// minerId = alamat wallet penerima hadiah (== coinbase receiver),
		// mengganti hash(IPv4+timestamp) lama yang tidak bisa diverifikasi.
		minerId: walletMiner,
		sign: {
			// Placeholder — signature node diisi saat finalisasi submit;
			// field ini tidak ikut preimage PoW.
			r: '',
			s: '',
			v: 0,
		},
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
			gasPrice,
			txCount: allTransactions.length,
			created_at: timestamp,
		},
		transactions: allTransactions,
		chainId: CHAIN_ID,
	})
}

/**
 * Retarget difficulty: berbasis WAKTU sejak tip hingga template dibuat —
 * `now - tip.timestamp` (bukan jarak tip vs orangtuanya).
 *
 * Mengapa jarak grandparent→tip (lama) menyebabkan bug: nilai itu hanya
 * mencerminkan interval DUA blok LAMAU. Saat rantai idle (job terus
 * kadaluarsa, blok tak pernah diselesaikan) angkanya tetap ~target 30 detik,
 * sehingga difficulty mandek (mis. 27.5) dan tidak pernah turun — persis
 * gejala "expiry berturut-turut tanpa penurunan". `now - tip.timestamp`
 * mengukur umur tip: idle time ikut terhitung → actualMs tumbuh → difficulty
 * turun.
 *
 * - Tip genesis (`height <= 0`): jarak waktu belum terdefinisi → pertahankan
 *   difficulty tip (dibatasi [MIN, MAX]) — perilaku lama dipertahankan;
 * - selain itu `retargetByTime` menghitung koreksi log2 terhadap target 30
 *   detik, dibatasi asimetris (naik maks +2, turun maks -4), dikunci
 *   [MIN, MAX] dan dikuantisasi 0.25 bit.
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
