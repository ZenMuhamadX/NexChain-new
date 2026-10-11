import { loggingErr } from 'src/logging/errorLog'
import { TxInterface } from 'src/types/transaction'
import { processSender } from './sender/processSender'
import { removeMemPool } from 'src/core/state/storage/mempool/removeMempool'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { saveTxHistory } from './saveTxHistory'
import { processReceiver } from './receiver/processReceiver'
import { saveTxByAddress } from 'src/core/transaction/saveTransactionByAddress'
import { COINBASE_SENDER } from 'src/core/transaction/createCoinbaseTransaction'
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
 * Penjaga idempotensi untuk kasus node mati sebelum `removeMemPool` jadi
 * bersandar pada keanggotaan blok, bukan pada nilai yang ditulis jalur tertentu.
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

export const processTransact = async (
	txData: TxInterface[],
	block: blockStruct,
): Promise<void> => {
	if (txData.length === 0) {
		loggingErr({
			message: 'data not found',
			stack: new Error().stack!,
			hint: 'data not found',
			timestamp: generateTimestampz(),
			level: 'error',
			priority: 'high',
			context: 'leveldb processTransaction',
		})
		return
	}

	for (const tx of txData) {
		// Branch COINBASE — hadiah blok. Bukan transaksi keluaran siapa pun:
		// tidak ada saldo pengirim yang didebit, tidak ada signature yang bisa
		// divalidasi ("COINBASE" bukan address, `processSender` pasti gagal
		// cek saldo). Cukup kredit penerima + index riwayat, sehingga hadiah
		// masuk lewat pipeline transaksi yang sama seperti transfer biasa
		// (pengganti giveReward/putAccount langsung) dan tampil di
		// wallet/explorer sebagai transaksi masuk ke penambang.
		if (tx.sender === COINBASE_SENDER) {
			try {
				await processReceiver(tx.receiver, tx.amount)
				await saveTxByAddress(tx.sender, tx.receiver, tx.txHash!)
				await saveTxHistory(tx.txHash!, withBlockMetadata(tx, block))
			} catch (error) {
				loggingErr({
					message: error instanceof Error ? error.message : 'Unknown error',
					stack: new Error().stack!,
					hint: 'Error processing coinbase (block reward) transaction',
					timestamp: generateTimestampz(),
					level: 'error',
					priority: 'high',
					context: 'leveldb processTransaction coinbase',
				})
			}
			continue
		}

		// Penjaga idempotensi: history 'confirmed' = transaksi PERNAH
		// dieksekusi (crash/sisa race di antara `saveTxHistory` dan
		// `removeMemPool`) — jangan dieksekusi dua kali; cukup bersihkan
		// dari mempool bila masih tersisa.
		if (tx.txHash && (await isTxExecuted(tx.txHash))) {
			removeMemPool(tx.txHash)
			continue
		}

		// Cabang kontrak (transferToContract / withdrawFromContract) DIHAPUS
		// bersama fitur smart contract — semua transaksi non-coinbase kini
		// dijalankan sebagai transfer biasa pengirim → penerima.

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
