import { rocksState } from 'src/core/state/db/chain'
import { getAccount } from 'src/core/state/account/getAccount'
import { logToConsole } from 'src/logging/logging'
import {
	allMempoolTxs,
	deleteMempoolTx,
} from 'src/core/state/storage/mempool/mempoolStore'

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
 * Sapuan keterjangkauan mempool — pembersih node-local, BUKAN konsensus.
 *
 * Saldo bisa turun di bawah Σ cost tx pending (tx lain tereksekusi lebih dulu,
 * reorg, kiriman ganda) sehingga ekor pool tak akan pernah valid; nonce pun
 * bisa basi. Tanpa sapuan, tx mati menumpuk dan reserve turunan tetap terkunci.
 *
 * Aturan per pengirim (deterministik — pengirim urut leksikografis, tx urut
 * `(nonce, txHash)`):
 *
 *   1. buang tx `nonce < account.nonce` (basi);
 *   2. dari `account.nonce`, pertahankan prefix KONTIGU terpanjang yang
 *      kumulatif `cost`-nya ≤ `balance`; buang pemutusnya (tak terjangkau /
 *      lubang-gap) beserta SELURUH sisanya.
 *
 * GAGAL-AMAN: pengirim yang akunnya tak terbaca (tanpa entri tersimpan,
 * alamat rusak, galat baca) DILEWATI utuh.
 */
export const sweepUnaffordableMempool = async (): Promise<SweepResult> => {
	const bySender = new Map<string, SenderEntry[]>()
	for (const tx of allMempoolTxs()) {
		if (
			!tx.from ||
			!tx.txHash ||
			!Number.isInteger(tx.nonce) ||
			tx.nonce < 0 ||
			typeof tx.amount !== 'number' ||
			typeof tx.fee !== 'number'
		) {
			continue
		}
		const entry = {
			txHash: tx.txHash,
			nonce: tx.nonce,
			cost: tx.amount + tx.fee,
		}
		const list = bySender.get(tx.from)
		if (list) list.push(entry)
		else bySender.set(tx.from, [entry])
	}

	const dropped: SweepDropped[] = []
	const toDelete: string[] = []
	let kept = 0

	for (const from of [...bySender.keys()].sort()) {
		const entries = bySender.get(from)!

		// Gagal-aman: tanpa entri akun tersimpan (atau alamat rusak / galat
		// baca), pengirim ini DILEWATI — jangan buang atas dasar keraguan.
		let stored: unknown
		try {
			stored = await rocksState.get(from).catch(() => null)
		} catch {
			logToConsole(`Sweep: skipping ${from} (unreadable account)`)
			continue
		}
		if (stored === null || stored === undefined) {
			logToConsole(`Sweep: skipping ${from} (no stored account)`)
			continue
		}
		const account = await getAccount(from).catch(() => undefined)
		if (!account) {
			logToConsole(`Sweep: skipping ${from} (unreadable account)`)
			continue
		}

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

	for (const txHash of toDelete) deleteMempoolTx(txHash)

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
		toDelete.push(entry.txHash)
		logToConsole(
			`Sweep: buang ${entry.txHash} (${from} nonce ${entry.nonce}, cost ${entry.cost}) — ${reason}`,
		)
	}
}
