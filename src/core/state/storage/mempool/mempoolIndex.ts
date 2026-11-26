import type { TxInterface } from 'src/types/transaction'
import {
	getMempoolTx,
	senderMempoolTxs,
} from 'src/core/state/storage/mempool/mempoolStore'

/**
 * Indeks mempool PER-PENGIRIM — sumber kebenaran jumlah tx pending satu
 * pengirim (ekspektasi nonce & `nex_getNextNonce`).
 *
 * Indeks ini hidup di RAM bersama transaksinya (`mempoolStore.ts`), jadi
 * jumlah dan reserve tidak mungkin drift dari kenyataan: keduanya diturunkan
 * dari Map yang sama, bukan counter tersimpan.
 */

/**
 * Batas tx pending per-pengirim — KEBIJAKAN node, BUKAN konsensus.
 *
 * Tanpa batas, satu akun bisa menghabiskan seluruh slot pool global. Angka 16
 * meniru `AccountSlots` geth; node lain boleh memakai batas berbeda tanpa fork.
 */
export const MAX_PENDING_PER_SENDER = 16

/**
 * Statistik SATU-pindai milik satu pengirim: jumlah tx pending DAN total
 * reserve (`Σ amount+fee`).
 */
export const senderIndexStats = async (
	from: string,
): Promise<{ count: number; totalCost: number }> => {
	const pending = senderMempoolTxs(from)
	let totalCost = 0
	for (const tx of pending) totalCost += (tx.amount ?? 0) + (tx.fee ?? 0)
	return { count: pending.length, totalCost }
}

/** Total reserve turunan (`Σ amount+fee`) milik satu pengirim. */
export const sumCostBySender = async (from: string): Promise<number> =>
	(await senderIndexStats(from)).totalCost

/**
 * Jumlah transaksi pending LENGKAP milik satu pengirim.
 *
 * Dipakai `validateTransactionNonce` dan `nex_getNextNonce`; keduanya wajib
 * melihat jumlah sebenarnya berapa pun ukuran mempool.
 */
export const countPendingBySender = async (from: string): Promise<number> =>
	(await senderIndexStats(from)).count

/** Baca SATU entri mempool lewat `txHash`; `undefined` bila tidak ada. */
export const readMempoolEntry = async (
	txHash: string,
): Promise<TxInterface | undefined> => getMempoolTx(txHash)

/**
 * Cari tx pending MILIK SATU PENGIRIM dengan `nonce` tertentu (bekal RBF).
 *
 * `nonce` di badan transaksi adalah satu-satunya sumber kebenaran — tidak ada
 * indeks kedua (`mpn:`) yang bisa drift dari kenyataan.
 */
export const findPendingByNonce = async (
	from: string,
	nonce: number,
): Promise<TxInterface | undefined> =>
	senderMempoolTxs(from).find((tx) => tx.nonce === nonce)

/**
 * SEMUA tx pending milik satu pengirim (`nex_getPendingByAddress`).
 *
 * Batas yang diterima: tx MASUK yang masih pending TIDAK terlihat di sini —
 * pengirimnya bukan pemilik alamat. Tx seperti itu baru muncul setelah masuk
 * blok.
 */
export const getPendingBySender = async (
	from: string,
): Promise<TxInterface[]> =>
	senderMempoolTxs(from).sort((a, b) => a.nonce - b.nonce)
