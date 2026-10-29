import { TxInterface } from 'src/types/transaction'
import { rocksMempool } from 'src/core/state/db/memPool'
import { TX_KEY_RANGE } from './mempoolIndex'

/**
 * Pembaca tunggal entri mempool.
 *
 * `limit` undefined = SELURUH entri (bekal penyusunan template blok);
 * angka = potongan global (bekal tampilan).
 */
const readMempool = async (limit?: number): Promise<TxInterface[]> => {
	const transactions: TxInterface[] = []

	for await (const [, value] of rocksMempool.iterator({
		gte: TX_KEY_RANGE.gte,
		lt: TX_KEY_RANGE.lt,
		values: true,
		keys: false,
		// `exactOptionalPropertyTypes` menolak `limit: undefined`.
		...(limit === undefined ? {} : { limit }),
	})) {
		transactions.push(JSON.parse(value.toString()) as TxInterface)
	}

	return transactions
}

/**
 * Baca entri mempool untuk TAMPILAN (`nex_getMempool`) — 100 entri per
 * rentang.
 *
 * ⚠️ Potongan ini GLOBAL (urut key, bukan per-pengirim), jadi jangan dipakai
 * untuk menghitung tx pending SESEORANG — pakai `countPendingBySender`
 * (lihat catatan cacat besarnya di `mempoolIndex.ts`).
 */
export const loadMempool = (): Promise<TxInterface[]> => readMempool(100)

/**
 * SELURUH entri mempool (tanpa potongan) — bekal penyusunan TEMPLATE BLOK.
 *
 * Batas 100 pernah merangkap dua peran sekaligus dan yang pertama adalah
 * cacat: kandidat template terpotong secara GLOBAL-urut-key, sehingga tx
 * berbayar tinggi bisa luput tanpa alasan dan fee tak punya keunggulan.
 * Kini pembacaannya penuh; yang MEMBATASI keluaran template adalah seleksi
 * berprioritas laju-fee di `work.ts` (budget byte), bukan pemotongan acak.
 */
export const loadAllMempool = (): Promise<TxInterface[]> => readMempool()
