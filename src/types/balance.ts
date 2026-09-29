export interface structBalance {
	address: string // Alamat akun Ethereum
	balance: number // Saldo dalam wei (unit terkecil ETH)
	transactionCount: number // Jumlah transaksi
	lastTransactionDate: number | null // Tanggal transaksi terakhir
	nonce: number // Nonce untuk menghindari replay attack
	isContract: boolean // Legacy: selalu false (fitur smart contract sudah dihapus)
}
