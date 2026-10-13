import { TxInterface } from 'src/types/transaction'
import { rocksMempool } from 'src/core/state/db/memPool'
import { TX_KEY_RANGES } from './mempoolIndex'

/**
 * Baca entri mempool untuk PENYUSUNAN BLOK & TAMPILAN — dengan batas 100
 * entri per rentang.
 *
 * ## `limit: 100` HANYA heuristika inkusi/tampilan — bukan akuntansi
 *
 * Potongan 100 ini membatasi berapa tx yang ikut satu template blok
 * (`work.ts` via `getValidTransactions`) dan berapa yang ditampilkan
 * `nex_getMempool`. Transaksi yang terpotong TIDAK hilang: masih tersimpan
 * penuh di mempool dan ikut blok berikutnya.
 *
 * ⚠️ JANGAN PERNAH memakai hasil fungsi ini untuk menghitung jumlah tx
 * pending SESEORANG (ekspektasi nonce, `nex_getNextNonce`, reserve
 * `pendingAmount`): potongan bersifat GLOBAL (urut key, bukan per-pengirim)
 * sehingga hitungan bisa salah saat mempool ramai — silakan lihat cacat
 * besarnya di catatan modul `mempoolIndex.ts`. Untuk akuntansi per-pengirim
 * gunakan `countPendingBySender`.
 */
export const loadMempool = async (): Promise<TxInterface[]> => {
	const transactions: TxInterface[] = []
	const seen = new Set<string>()

	for (const range of TX_KEY_RANGES) {
		for await (const [, value] of rocksMempool.iterator({
			gte: range.gte,
			lt: range.lt,
			values: true,
			keys: false,
			limit: 100, // Batas inkusi template & tampilan — bukan akuntansi
		})) {
			const data = JSON.parse(value.toString()) as TxInterface
			// hindari duplikat bila txHash sama
			if (data.txHash && seen.has(data.txHash)) continue
			if (data.txHash) seen.add(data.txHash)
			transactions.push(data)
		}
	}

	return transactions
}
