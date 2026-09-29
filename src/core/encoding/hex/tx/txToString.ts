import { TxInterface } from 'src/types/transaction'

// Fungsi untuk mengonversi transaksi menjadi string untuk hashing
export const txToString = (tx: TxInterface): string => {
	// Gabungkan properti transaksi yang relevan menjadi string
	return `${tx.sender}:${tx.receiver}:${tx.amount}:${tx.timestamp}`
}
