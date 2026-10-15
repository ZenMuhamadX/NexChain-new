import { rocksMempool } from 'src/core/state/db/memPool'
import { rocksState } from 'src/core/state/db/state'
import { getAccount } from 'src/core/state/account/getAccount'
import { logToConsole } from 'src/logging/logging'
import type { TxInterface } from 'src/types/transaction'
import {
	ALL_INDEX_GTE,
	ALL_INDEX_LT,
	ensureMempoolIndex,
	mempoolTxKey,
	runMempoolOp,
	senderIndexKey,
} from './mempoolIndex'

/**
 * Key mempool format LAMA (`Tx-0x<hash>`) — hanya cadangan baca & hapus
 * (meniru `removeMempool.ts`).
 */
const legacyMempoolTxKey = (txHash: string): string => `Tx-0x${txHash}`

/** Alasan tx dibuang sapuan — dicatat lewat logger repo. */
export type SweepDropReason = 'stale' | 'gap' | 'unaffordable'

export interface SweepDropped {
	from: string
	txHash: string
	nonce: number
	cost: number
	reason: SweepDropReason
}

export interface SweepResult {
	/** Jumlah pengirim berbeda yang dipindai. */
	senders: number
	/** Jumlah tx yang dipertahankan. */
	kept: number
	/** Rincian tx yang dibuang (deterministik: urut pengirim lalu nonce). */
	dropped: SweepDropped[]
}

/** Entri pool satu pengirim yang berhasil dibaca (beserta biayanya). */
interface SenderEntry {
	txHash: string
	nonce: number
	cost: number
}

/**
 * Baca SATU entri mempool lewat `txHash` (format baru, cadangan format
 * lama); `undefined` bila hilang/rusak.
 *
 * MENGAPA baca entri, bukan nilai indeks: nilai indeks (`{cost}`) TIDAK
 * menyimpan `nonce`, dan sapuan butuh keduanya. Membaca transaksi penuh
 * membuat nilai indeks lama (yang tak punya `nonce`) tetap sah tanpa
 * migrasi — pembaca lama (`senderOf`, `rebuildBody`, `costOf`) tak
 * tersentuh. Entri yang tak terbaca DILEWATI (dibiarkan), bukan dibuang.
 */
const readEntry = async (txHash: string): Promise<TxInterface | undefined> => {
	for (const key of [mempoolTxKey(txHash), legacyMempoolTxKey(txHash)]) {
		const stored: unknown = await rocksMempool.get(key).catch(() => null)
		if (stored === null || stored === undefined) continue
		try {
			const parsed: unknown =
				typeof stored === 'string' ? JSON.parse(stored) : stored
			if (parsed !== null && typeof parsed === 'object')
				return parsed as TxInterface
		} catch {
			// nilai rusak — coba kunci cadangan, lalu serahkan ke pemanggil
		}
	}
	return undefined
}

/**
 * Sapuan keterjangkauan mempool — pembersih node-local, BUKAN konsensus.
 *
 * MENGAPA ada (Gelombang 4): saldo bisa turun di bawah Σ cost tx pending
 * (tx lain tereksekusi lebih dulu, reorg, kiriman ganda) sehingga ekor pool
 * tak akan pernah valid; nonce pun bisa basi (`nonce < account.nonce`).
 * Tanpa sapuan, tx mati menumpuk, reserve turunan tetap terkunci, dan
 * template `nex_getWork` tercemar.
 *
 * Aturan per pengirim (deterministik — pengirim urut leksikografis, tx
 * urut `(nonce, txHash)`):
 *
 *   1. buang tx `nonce < account.nonce` (basi);
 *   2. dari `account.nonce`, pertahankan prefix KONTIGU terpanjang yang
 *      kumulatif `cost`-nya ≤ `balance`; buang pemutusnya (tak terjangkau
 *      / lubang-gap) beserta SELURUH sisanya.
 *
 * GAGAL-AMAN: pengirim yang akunnya tak terbaca (tanpa entri tersimpan,
 * alamat rusak, galat baca) DILEWATI utuh — tak pernah dibuang karena
 * keraguan baca. Penghapusan (tx + indeksnya) dilakukan dalam SATU batch
 * di antrean serial yang sama dengan tulis/hapus mempool lain.
 */
export const sweepUnaffordableMempool = async (): Promise<SweepResult> => {
	await ensureMempoolIndex()
	return runMempoolOp(sweepBody)
}

const sweepBody = async (): Promise<SweepResult> => {
	// Kumpulkan txHash per pengirim dari SELURUH kunci indeks — lengkap,
	// bukan potongan 100-global `loadMempool`.
	const bySender = new Map<string, string[]>()
	for await (const key of rocksMempool.keys({
		gte: ALL_INDEX_GTE,
		lt: ALL_INDEX_LT,
	})) {
		const indexKey = key.toString()
		// `mpf:<from>:<txHash>` — `from` tak mengandung `:`.
		const separator = indexKey.indexOf(':', 4)
		if (separator < 0) continue
		const from = indexKey.slice(4, separator)
		const txHash = indexKey.slice(separator + 1)
		if (!from || !txHash) continue
		const list = bySender.get(from)
		if (list) list.push(txHash)
		else bySender.set(from, [txHash])
	}

	const dropped: SweepDropped[] = []
	let kept = 0
	type DelOp = { type: 'del'; key: string }
	const ops: DelOp[] = []

	for (const from of [...bySender.keys()].sort()) {
		const txHashes = bySender.get(from)!

		// Gagal-aman: tanpa entri akun tersimpan (atau alamat rusak / galat
		// baca), pengirim ini DILEWATI — jangan buang atas dasar keraguan.
		// (`getAccount` mengembalikan akun-nol untuk alamat asing, jadi
		// keberadaan entri mentah yang diperiksa, bukan hasilnya.)
		let stored: unknown
		try {
			stored = await rocksState.get(from).catch(() => null)
		} catch {
			logToConsole(`Sweep: lewati ${from} (akun tak terbaca)`)
			continue
		}
		if (stored === null || stored === undefined) {
			logToConsole(`Sweep: lewati ${from} (tanpa akun tersimpan)`)
			continue
		}
		const account = await getAccount(from).catch(() => undefined)
		if (!account) {
			logToConsole(`Sweep: lewati ${from} (akun tak terbaca)`)
			continue
		}

		// Muat SEMUA entri pengirim ini (cost + nonce dari tx-nya); yang
		// hilang/rusak dilewati (dibiarkan di pool).
		const entries: SenderEntry[] = []
		for (const txHash of txHashes) {
			const tx = await readEntry(txHash).catch(() => undefined)
			if (
				!tx ||
				!Number.isInteger(tx.nonce) ||
				tx.nonce < 0 ||
				typeof tx.amount !== 'number' ||
				typeof tx.fee !== 'number'
			) {
				continue
			}
			entries.push({ txHash, nonce: tx.nonce, cost: tx.amount + tx.fee })
		}
		// Deterministik: urut nonce menaik, seri diputus txHash.
		entries.sort((a, b) => a.nonce - b.nonce || (a.txHash < b.txHash ? -1 : 1))

		let expected = account.nonce
		let running = 0
		let cutting = false
		let cutReason: SweepDropReason = 'unaffordable'
		for (const entry of entries) {
			if (!cutting) {
				if (entry.nonce < expected) {
					drop(entry, from, 'stale')
					continue
				}
				if (entry.nonce > expected) {
					// Lubang: tx ini (dan semua di atasnya) tak akan pernah
					// tereksekusi — admission hanya menerima nonce pas.
					cutting = true
					cutReason = 'gap'
				} else if (running + entry.cost <= account.balance) {
					running += entry.cost
					expected++
					kept++
					continue
				} else {
					cutting = true
					cutReason = 'unaffordable'
				}
			}
			drop(entry, from, cutReason)
		}
	}

	if (ops.length > 0) await rocksMempool.batch(ops, { sync: false })

	return { senders: bySender.size, kept, dropped }

	function drop(
		entry: SenderEntry,
		from: string,
		reason: SweepDropReason,
	): void {
		dropped.push({
			from,
			txHash: entry.txHash,
			nonce: entry.nonce,
			cost: entry.cost,
			reason,
		})
		ops.push({ type: 'del', key: senderIndexKey(from, entry.txHash) })
		ops.push({ type: 'del', key: mempoolTxKey(entry.txHash) })
		ops.push({ type: 'del', key: legacyMempoolTxKey(entry.txHash) })
		logToConsole(
			`Sweep: buang ${entry.txHash} (${from} nonce ${entry.nonce}, cost ${entry.cost}) — ${reason}`,
		)
	}
}
