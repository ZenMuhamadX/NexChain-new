/**
 * Bus peristiwa node yang NETRAL (tanpa dependensi P2P).
 *
 * Tujuan: `src/core/` (commit blok saat mining, admission transaksi) perlu
 * memberi tahu pihak lain bahwa sesuatu baru terjadi, TANPA harus mengimpor
 * `src/p2p/` (itu akan membalik arah dependensi: core menjadi tahu jaringan).
 *
 * Jadi core hanya "menerbitkan" ke bus kecil ini; `src/p2p/node.ts` yang
 * berlangganan lalu menyebarkannya ke peer. Core tetap tidak tahu apa-apa
 * tentang P2P.
 *
 * Modul ini murni (hanya tipe + Set) sehingga aman dipaketkan ke browser.
 */
import type { Block } from 'src/core/block/blockModel'
import type { TxInterface } from 'src/types/transaction'

type Listener<T> = (value: T) => void

const blockListeners = new Set<Listener<Block>>()
const txListeners = new Set<Listener<TxInterface>>()

/** Berlangganan blok lokal yang baru ter-commit. Balikan = fungsi lepas. */
export const subscribeBlocks = (listener: Listener<Block>): (() => void) => {
	blockListeners.add(listener)
	return () => {
		blockListeners.delete(listener)
	}
}

/** Berlangganan transaksi yang baru diterima mempool. Balikan = fungsi lepas. */
export const subscribeTxs = (listener: Listener<TxInterface>): (() => void) => {
	txListeners.add(listener)
	return () => {
		txListeners.delete(listener)
	}
}

/**
 * Terbitkan blok baru. Listener yang melempar diabaikan — jalur commit TIDAK
 * BOLEH gagal hanya karena penyiar P2P bermasalah.
 */
export const publishBlock = (block: Block): void => {
	for (const listener of blockListeners) {
		try {
			listener(block)
		} catch {
			// sengaja diabaikan: kegagalan penyiar bukan kegagalan commit
		}
	}
}

/** Terbitkan transaksi baru (lihat catatan `publishBlock`). */
export const publishTx = (tx: TxInterface): void => {
	for (const listener of txListeners) {
		try {
			listener(tx)
		} catch {
			// sengaja diabaikan
		}
	}
}
