import { rocksMempool } from 'src/core/state/db/memPool'
import { isSimulation } from 'src/core/state/journal/writeBuffer'
import { mempoolTxKey, runMempoolOp, senderIndexKey } from './mempoolIndex'

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
 * TIDAK PERNAH menolak: kegagalan dicatat lalu dilewati (pemanggil lama
 * memanggilnya tanpa `await` di jalur zombie; transaksi tetap dianggap
 * selesai dieksekusi dan pembersihan berikutnya bersifat idempoten).
 */
export const removeMemPool = async (txHash: string): Promise<void> => {
	if (!txHash) return
	// Simulasi (template/replay) TIDAK boleh menghapus tx: template yang tak
	// pernah ditambang, atau replay saat boot, tidak berarti tx sudah masuk
	// blok. Mempool hanya berubah saat commit nyata.
	if (isSimulation()) return
	try {
		await runMempoolOp(async () => {
			const key = mempoolTxKey(txHash)

			const stored = await rocksMempool.get(key).catch(() => null)

			const ops: RemoveOp[] = [{ type: 'del', key }]
			const from = senderOf(stored)
			if (from) ops.push({ type: 'del', key: senderIndexKey(from, txHash) })

			await rocksMempool.batch(ops, { sync: true })
		})
	} catch (error) {
		console.error('Error removing transaction:', error)
	}
}
