import { rocksMempool } from 'src/core/state/db/memPool'
import { mempoolTxKey, senderIndexKey, runMempoolOp } from './mempoolIndex'

/**
 * Key format LAMA (`Tx-0x<hash>`) — hanya untuk pembuangan sisa data
 * (range kedua di `TX_KEY_RANGES`).
 */
const legacyMempoolTxKey = (txHash: string): string => `Tx-0x${txHash}`

type RemoveOp = { type: 'del'; key: string }

/** Ambil `from` dari nilai tersimpan; `undefined` bila tidak terbaca. */
const senderOf = (stored: unknown): string | undefined => {
	try {
		const parsed: unknown =
			typeof stored === 'string' ? JSON.parse(stored) : stored
		if (
			parsed !== null &&
			typeof parsed === 'object' &&
			typeof (parsed as { from?: unknown }).from === 'string'
		) {
			return (parsed as { from: string }).from
		}
	} catch {
		// nilai bukan JSON (sisa format sangat lama) — tanpa `from`
	}
	return undefined
}

/**
 * Buang transaksi dari mempool BERSAMA indeks per-pengirimnya — SATU batch
 * atomik (lihat catatan atomic di `mempoolIndex.ts`).
 *
 * `from` dibaca dari nilai yang tersimpan (bukan parameter), sehingga
 * SEMUA pemanggil — termasuk pembersihan zombie di `work.ts` yang hanya
 * punya `txHash` — otomatis ikut membersihkan indeks. Tanpa ini, entri
 * indeks yatim akan menaikkan ekspektasi nonce selamanya dan mengunci
 * pengirim (persis cacat yang diperbaiki indeks ini).
 *
 * Data format lama (`Tx-0x…`) ikut dibaca sebagai cadangan dan key lamanya
 * ikut dihapus — eksekusi transaksi lama akhirnya benar-benar bersih.
 *
 * TIDAK PERNAH menolak: kegagalan dicatat lalu dilewati (pemanggil lama
 * memanggilnya tanpa `await` di jalur zombie; transaksi tetap dianggap
 * selesai dieksekusi dan pembersihan berikutnya bersifat idempoten).
 */
export const removeMemPool = async (txHash: string): Promise<void> => {
	if (!txHash) return
	try {
		await runMempoolOp(async () => {
			const currentKey = mempoolTxKey(txHash)
			const legacyKey = legacyMempoolTxKey(txHash)

			const stored = await rocksMempool.get(currentKey).catch(() => null)
			const legacyStored =
				stored === null
					? await rocksMempool.get(legacyKey).catch(() => null)
					: null

			const ops: RemoveOp[] = [
				{ type: 'del', key: currentKey },
				{ type: 'del', key: legacyKey },
			]
			const from = senderOf(stored ?? legacyStored)
			if (from) ops.push({ type: 'del', key: senderIndexKey(from, txHash) })

			await rocksMempool.batch(ops, { sync: true })
		})
	} catch (error) {
		console.error('Error removing transaction:', error)
	}
}
