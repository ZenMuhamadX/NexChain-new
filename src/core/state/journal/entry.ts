/**
 * Enumerasi touch-set + tipe record undo journal.
 *
 * **Semua kunci yang akan ditulis saat meng-commit sebuah blok dapat dihitung
 * dari blok itu sendiri** (tanpa eksekusi). Inilah yang membuat WAL bisa
 * ditulis SEKALI per blok, sebelum tulisan state terjadi (lihat
 * `journal-difficulty-design.md` A.2).
 *
 * Sumber kunci harus mengikuti penulis sebenarnya. Untuk hadiah blok dipakai
 * `createCoinbaseRecord` (helper yang SAMA dengan `processTransact`) supaya
 * `from`/`txHash` coinbase ikut terenumerasi dan tidak "drift" bila identitas
 * hadiah berubah.
 */
import { Block } from 'src/core/block/blockModel'
import { createCoinbaseRecord } from 'src/core/transaction/createCoinbaseTransaction'
import type { JournalStoreName, JournalTouchSet } from './guard'

/** Satu kunci yang disentuh blok, beserta nilai lamanya (untuk rollback). */
export interface JournalEntry {
	store: JournalStoreName
	key: string
	/** Nilai mentah sebelum commit; `null` = kunci belum ada → rollback = del. */
	prev: string | null
}

/** Record undo untuk satu blok: `journal:<height>`. */
export interface JournalRecord {
	height: number
	hash: string
	entries: JournalEntry[]
}

/**
 * Hitung SEMUA kunci yang ditulis saat meng-commit `block`.
 *
 * | Store   | Pola kunci                          | Sumber                          |
 * |---------|-------------------------------------|---------------------------------|
 * | state   | `blockState`, `blockHeight:<h>`     | blok (selalu)                   |
 * | state   | `<alamat>`                          | coinbase.receiver, tx.from, tx.receiver |
 * | history | `txnHash:<txHash>`                  | record coinbase + tiap `tx.txHash` |
 * | history | `address:<alamat>`                  | coinbase.from/receiver + tx.from/receiver |
 * | block   | `blockHash:<hash>`                  | hash blok                       |
 *
 * (Baris `pendingBalance:<from>` dihapus Gelombang 2 bersama kuncinya:
 * reserve kini turunan indeks mempool, bukan tulisan state — tidak ada lagi
 * yang boleh menulis kunci itu, sehingga enumerasi pun tidak boleh
 * menyebutnya.)
 */
export const enumerateTouchSet = (block: Block): JournalTouchSet => {
	const state = new Set<string>()
	const history = new Set<string>()
	const blk = new Set<string>()

	const height = block.block.height

	// Selalu: pointer state + indeks height + badan blok.
	state.add('blockState')
	state.add(`blockHeight:${height}`)
	blk.add(`blockHash:${block.block.header.hash}`)

	// Hadiah blok (coinbase) — pakai helper yang sama dengan penulis.
	const coinbase = createCoinbaseRecord(
		block.block.coinbaseTransaction.receiver,
		block.block.coinbaseTransaction.amount,
		height,
	)
	state.add(coinbase.receiver)
	if (coinbase.txHash) history.add(`txnHash:${coinbase.txHash}`)
	if (coinbase.from) history.add(`address:${coinbase.from}`)
	history.add(`address:${coinbase.receiver}`)

	// Transaksi pengguna.
	for (const tx of block.block.transactions) {
		if (tx.txHash) history.add(`txnHash:${tx.txHash}`)
		if (tx.from) {
			state.add(tx.from)
			history.add(`address:${tx.from}`)
		}
		state.add(tx.receiver)
		history.add(`address:${tx.receiver}`)
	}

	return { state, history, block: blk }
}
