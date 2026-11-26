import { TxInterface } from 'src/types/transaction'
import { allMempoolTxs } from './mempoolStore'

/**
 * Pembaca tunggal entri mempool.
 *
 * `limit` undefined = SELURUH entri (bekal penyusunan template blok);
 * angka = potongan global (bekal tampilan).
 */
const readMempool = async (limit?: number): Promise<TxInterface[]> => {
	const transactions = allMempoolTxs()
	return limit === undefined ? transactions : transactions.slice(0, limit)
}

/**
 * Baca entri mempool untuk TAMPILAN (`nex_getMempool`) — 100 entri.
 *
 * Potongan ini GLOBAL (urut insertion, bukan per-pengirim), jadi jangan
 * dipakai untuk menghitung tx pending SESEORANG — pakai
 * `countPendingBySender`.
 */
export const loadMempool = (): Promise<TxInterface[]> => readMempool(100)

/**
 * SELURUH entri mempool (tanpa potongan) — bekal penyusunan TEMPLATE BLOK.
 *
 * Yang MEMBATASI keluaran template adalah seleksi berprioritas laju-fee di
 * `work.ts` (budget byte), bukan pemotongan acak.
 */
export const loadAllMempool = (): Promise<TxInterface[]> => readMempool()
