import { loggingErr } from 'src/logging/errorLog'
import { TxInterface } from 'src/types/transaction'
import { processSender } from './sender/processSender'
import { removeMemPool } from 'src/core/state/storage/mempool/removeMempool'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { saveTxHistory } from './saveTxHistory'
import { processReceiver } from './receiver/processReceiver'
import { saveTxByAddress } from 'src/core/transaction/saveTransactionByAddress'
import { createCoinbaseRecord } from 'src/core/transaction/createCoinbaseTransaction'
import { isTxExecuted } from './isTxExecuted'
import { blockStruct } from 'src/types/block'

/**
 * Lampirkan asal blok ke entri riwayat.
 *
 * Inilah yang membuat WAKTU transaksi bisa diketahui tanpa menyimpan
 * `timestamp` di dalam transaksi. Timestamp transaksi dikendalikan client dan
 * tidak diverifikasi siapa pun; waktu yang sebenarnya adalah milik BLOK.
 *
 * Sekaligus menjadi penanda "sudah dieksekusi": keberadaan `metadata.blockHeight`
 * adalah fakta rantai (ground truth), menggantikan flag `status` yang mutable.
 */
const withBlockMetadata = (tx: TxInterface, block: blockStruct) => ({
	...tx,
	metadata: {
		blockHeight: block.height,
		blockHash: block.header.hash,
		blockTimestamp: block.header.timestamp,
		merkleRoot: block.merkleRoot,
	},
})

/**
 * Kredit hadiah blok ke penambang — **logika protokol, bukan transaksi**.
 *
 * Sebelumnya hadiah dibungkus sebagai pseudo-transaksi (`sender = 'COINBASE'`)
 * yang ikut masuk `block.transactions`. Sekarang hadiah dibaca dari field blok
 * `coinbaseTransaction`, yang sudah ter-commit di preimage PoW lewat
 * `minerId` + `totalReward` + `coinbaseTransaction` (lihat `prepareBlock`).
 *
 * Urutannya penting: hadiah dikredit SEBELUM transaksi blok diproses, supaya
 * penambang masih bisa membelanjakan hadiahnya di blok yang sama — perilaku
 * lama yang dipertahankan.
 *
 * Record riwayat tetap ditulis agar hadiah muncul di riwayat alamat penambang
 * seperti sebelumnya. Ia berbentuk sama dengan transaksi, tapi tidak pernah
 * menjadi bagian dari daftar transaksi blok.
 */
const applyBlockReward = async (block: blockStruct): Promise<void> => {
	const { receiver, amount } = block.coinbaseTransaction
	const record = createCoinbaseRecord(
		receiver,
		amount,
		block.header.timestamp,
		block.height,
	)

	// Idempotensi: kalau record hadiah blok ini sudah ada, jangan kredit dua
	// kali (mis. proses diulang setelah restart).
	if (record.txHash && (await isTxExecuted(record.txHash))) return

	try {
		await processReceiver(receiver, amount)
		await saveTxByAddress(record.sender, record.receiver, record.txHash!)
		await saveTxHistory(record.txHash!, withBlockMetadata(record, block))
	} catch (error) {
		loggingErr({
			message: error instanceof Error ? error.message : 'Unknown error',
			stack: new Error().stack!,
			hint: 'Error applying block reward (coinbase)',
			timestamp: generateTimestampz(),
			level: 'error',
			priority: 'high',
			context: 'leveldb processTransaction coinbase',
		})
	}
}

/**
 * Terapkan satu blok ke state: hadiah blok, lalu seluruh transaksi pengguna.
 *
 * Blok TANPA transaksi pengguna adalah hal yang normal (hadiah tetap
 * dibayarkan), jadi kosongnya `txData` bukan kondisi error.
 */
export const processTransact = async (
	txData: TxInterface[],
	block: blockStruct,
): Promise<void> => {
	// 1. Hadiah blok — selalu, termasuk blok tanpa transaksi.
	await applyBlockReward(block)

	// 2. Transaksi pengguna.
	if (txData.length === 0) return

	for (const tx of txData) {
		// Penjaga idempotensi: transaksi yang sudah pernah dieksekusi
		// (crash/sisa race di antara `saveTxHistory` dan `removeMemPool`)
		// tidak dijalankan dua kali — cukup dibersihkan dari mempool.
		if (tx.txHash && (await isTxExecuted(tx.txHash))) {
			removeMemPool(tx.txHash)
			continue
		}

		try {
			await processSender(tx.sender, tx.amount, tx.fee!)
			await processReceiver(tx.receiver, tx.amount)
			await saveTxByAddress(tx.sender, tx.receiver, tx.txHash!)
			await saveTxHistory(tx.txHash!, withBlockMetadata(tx, block))
			removeMemPool(tx.txHash!)
		} catch (error) {
			loggingErr({
				message: error instanceof Error ? error.message : 'Unknown error',
				stack: new Error().stack!,
				hint: 'Error processing transaction',
				timestamp: generateTimestampz(),
				level: 'error',
				priority: 'high',
				context: 'leveldb processTransaction',
			})
		}
	}
}
