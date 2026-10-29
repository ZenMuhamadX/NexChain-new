import type { TxInterface } from '../api/types'

/**
 * Sentinel `from` pada RECORD RIWAYAT hadiah blok.
 *
 * Hadiah blok bukan transaksi: tidak ditandatangani, tidak punya nonce, dan
 * `from`-nya sengaja bukan alamat sah. Nilai ini HARUS sama dengan
 * `COINBASE_SENDER` di `src/core/transaction/createCoinbaseTransaction.ts`.
 *
 * Tanpa special-case, explorer membuat tautan `/address/COINBASE` untuk
 * setiap baris hadiah — halaman alamat yang pasti invalid. Itu terjadi di
 * setiap blok, jadi ini bukan kasus pinggiran.
 */
export const COINBASE_SENDER = 'COINBASE'

/** Benar bila entri riwayat ini adalah hadiah blok, bukan transfer. */
export const isCoinbaseRecord = (tx: Pick<TxInterface, 'from'>): boolean =>
	tx.from === COINBASE_SENDER

/** Apakah entri ini punya tanda tangan nyata (hadiah blok: r = s = 0). */
export const hasSignature = (tx: Pick<TxInterface, 'sign'>): boolean =>
	typeof tx.sign?.r === 'string' && tx.sign.r.replace(/^0+/, '').length > 0
