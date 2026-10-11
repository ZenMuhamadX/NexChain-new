import { TxInterface } from 'src/types/transaction'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { sha256 } from 'src/core/encoding/sha256'

/**
 * Penanda hadiah blok pada RECORD RIWAYAT.
 *
 * Sengaja BUKAN format address (`NxC`/`NxS`) sehingga tidak mungkin dimiliki
 * pihak mana pun. Setelah coinbase dikeluarkan dari daftar transaksi, sentinel
 * ini TIDAK lagi bagian dari konsensus — ia hanya label tampilan, supaya
 * wallet & explorer bisa mengenali entri hadiah dan memberi label yang tepat.
 */
export const COINBASE_SENDER = 'COINBASE'

const COINBASE_MESSAGE = 'Block reward'

/**
 * Id deterministik untuk hadiah sebuah blok.
 *
 * Berbasis TINGGI BLOK, bukan isi transaksi: hadiah tidak punya tanda tangan
 * dan tidak punya hash payload, jadi identitasnya harus datang dari blok yang
 * menghasilkannya. Ini juga menjamin dua blok berbeda tidak pernah bertabrakan
 * kunci riwayatnya, betapapun mirip isinya.
 */
export const coinbaseRewardId = (blockHeight: number): string =>
	`TxC${sha256(`coinbase:${blockHeight}`, 'hex') as string}`

/**
 * Record riwayat untuk hadiah blok — **bukan transaksi**.
 *
 * Hadiah blok sekarang logika protokol: `processTransact` mengkredit
 * `block.coinbaseTransaction` sebelum transaksi blok diproses. Namun agar
 * hadiah tetap tampil di riwayat alamat penambang (perilaku lama yang sudah
 * dikenal wallet & explorer), record ini tetap ditulis ke store riwayat dan
 * indeks alamat — berbentuk sama seperti transaksi, tapi tidak pernah masuk
 * ke `block.transactions`.
 *
 * Bentuknya sengaja dibuat seragam dengan transaksi supaya
 * `getHistoryByAddress` / `getHistoryByTxHash` tidak perlu tahu bedanya.
 */
export const createCoinbaseRecord = (
	receiver: string,
	amount: number,
	blockTimestamp: number,
	blockHeight: number,
): TxInterface => ({
	format: 'nexu',
	sender: COINBASE_SENDER,
	receiver,
	amount,
	timestamp: blockTimestamp,
	extraMessage: COINBASE_MESSAGE,
	fee: 0,
	nonce: 0,
	status: 'confirmed',
	isValid: true,
	isPending: false,
	hexInput: stringToHex(COINBASE_MESSAGE),
	sign: { v: 0, r: '0', s: '0' },
	txHash: coinbaseRewardId(blockHeight),
})
