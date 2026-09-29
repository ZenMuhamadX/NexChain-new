import { TxInterface } from 'src/types/transaction'
import { rocksMempool } from 'src/core/state/db/memPool'

/**
 * Range key khusus transaksi di mempool:
 *
 * - "0x"   .. "0y"   : format yang ditulis saveMempool/removeMempool
 *                      (`0x${txHash}`, dan txHash selalu diawali "TxC").
 * - "Tx-"  .. "Tx."  : format lama ("Tx-0x..."), dipertahankan agar data
 *                      lama yang belum terbaca tetap terambil.
 *
 * Catatan perbaikan: range sebelumnya ("Tx-0x".."Tx-0y") TIDAK PERNAH cocok
 * dengan key yang ditulis saveMempool, sehingga mempool selalu terbaca kosong
 * dan transaksi tidak pernah masuk blok.
 */
const TX_KEY_RANGES = [
	{ gte: '0x', lt: '0y' },
	{ gte: 'Tx-', lt: 'Tx.' },
]

export const loadMempool = async (): Promise<TxInterface[]> => {
	const transactions: TxInterface[] = []
	const seen = new Set<string>()

	for (const range of TX_KEY_RANGES) {
		for await (const [, value] of rocksMempool.iterator({
			gte: range.gte,
			lt: range.lt,
			values: true,
			keys: false,
			limit: 100, // Membatasi jumlah item menjadi 100
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
