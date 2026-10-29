/**
 * Akun seperti yang dilihat RPC/klien. `address` diisi dari KUNCI saat dibaca
 * (tidak disimpan di leaf — lihat `encoding/rlp/accountCodec.ts`).
 */
export interface structBalance {
	address: string
	balance: number // saldo dalam nexu (unit terkecil, 1 NXC = 10^6 nexu)
	transactionCount: number // jumlah transaksi masuk + keluar (indikator aktivitas)
	lastTransactionDate: number | null // timestamp BLOK transaksi terakhir, epoch ms
	nonce: number // hanya bertambah untuk transaksi KELUAR (anti-replay)
}
