import { HexString } from 'src/types/block'

/**
 * NIAT transaksi dari pengguna (form wallet / CLI) — belum on-chain.
 *
 * `format` di sini adalah SATUAN dari `amount` ('NXC' atau 'nexu'), bukan
 * field on-chain. Ia hanya dipakai `createUnsignedTransaction` untuk memilih
 * konversi; setelah dikonversi, satuan selalu nexu dan `format` tidak ikut
 * ke rantai.
 *
 * `timestamp` DIHAPUS: waktu transaksi milik blok, bukan transaksi. Timestamp
 * yang dikirim client tidak diverifikasi siapa pun, sehingga tidak layak ikut
 * di-hash.
 *
 * `extraMessage` diganti `data`: field data generik (bytes), opsional, tanpa
 * nilai default yang wajib dibawa setiap transaksi.
 */
export interface comTxInterface {
	receiver: string
	format: 'NXC' | 'nexu'
	sender: string
	amount: number
	fee: number
	/** Data arbitrer (UTF-8 direpresentasikan sebagai hex). Opsional. */
	data?: HexString
}
