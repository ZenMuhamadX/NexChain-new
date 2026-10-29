import { getHistoryByTxHash } from './getHistoryByTxHash'
import { TxInterface } from 'src/types/transaction'
import { rocksHistory } from 'src/core/state/db/history'

/**
 * Riwayat satu alamat, terbaru dulu.
 *
 * Indeksnya per-entri (`addr:<alamat>:<tinggi>:<txHash>`, ditulis
 * `saveTxByAddress`), jadi ini satu range scan — bukan baca array raksasa lalu
 * decode. `lt` memakai karakter tepat setelah `:` (`;`) sebagai batas atas
 * range, `reverse` menaruh blok terbaru di depan.
 *
 * shortcut: tanpa batas jumlah dan tanpa cursor — explorer memaginasi di sisi
 * klien, jadi batas server akan menyembunyikan riwayat tanpa jejak di UI.
 * Upgrade ke pasangan (limit, cursor) saat satu alamat melewati ~10^4 tx.
 */
export const getHistoryByAddress = async (
	address: string,
): Promise<{ history: TxInterface[]; count: number }> => {
	const prefix = `addr:${address}:`
	const txHashes: string[] = []
	for await (const [key] of rocksHistory.iterator({
		gte: prefix,
		lt: `${prefix.slice(0, -1)};`,
		reverse: true,
	})) {
		txHashes.push(String(key).split(':').pop()!)
	}

	const history = await Promise.all(
		txHashes.map((txHash) => getHistoryByTxHash(txHash)),
	)
	return { count: history.length, history }
}
