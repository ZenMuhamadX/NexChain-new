import { TxInterface } from 'src/types/transaction'
import { rocksMempool } from 'src/core/state/db/memPool'
import { mempoolTxKey, senderIndexKey, runMempoolOp } from './mempoolIndex'

/**
 * Simpan transaksi ke mempool BERSAMA indeks per-pengirimnya.
 *
 * Keduanya ditulis dalam SATU `batch` level (WAL ter grup) — crash di
 * tengah tulis tidak bisa menghasilkan entri mempool tanpa indeks (atau
 * sebaliknya), yang akan menyesatkan akuntansi nonce. Lihat catatan atomic
 * di `mempoolIndex.ts`.
 */
export const saveMempool = async (transaction: TxInterface): Promise<void> => {
	if (!transaction) {
		console.log('no data')
		return
	}
	const txHash = transaction.txHash
	const from = transaction.from
	// Guard fail-closed: tanpa `txHash` tidak ada kunci; tanpa `from` tidak
	// ada indeks per-pengirim — keduanya merusak akuntansi nonce. Transaksi
	// yang sampai di sini SELALU sudah lolos validator penuh (`txHash` dan
	// `from` dihitung dari wire oleh `decodeTx`), jadi guard ini hanya
	// jaring pengaman terhadap pemanggil kelakuan.
	if (!txHash || !from) {
		console.error('saveMempool: txHash & from wajib ada sebelum menyimpan')
		return
	}
	const parseMempool = JSON.stringify(transaction)
	await runMempoolOp(() =>
		rocksMempool.batch(
			[
				{ type: 'put', key: mempoolTxKey(txHash), value: parseMempool },
				{
					type: 'put',
					key: senderIndexKey(from, txHash),
					// `cost` = amount+fee — bekal jalur buang/evictasi ke depan.
					value: JSON.stringify({
						cost: (transaction.amount ?? 0) + (transaction.fee ?? 0),
					}),
				},
			],
			{ sync: false },
		),
	)
}
