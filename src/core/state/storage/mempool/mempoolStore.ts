import type { TxInterface } from 'src/types/transaction'

/**
 * Mempool tinggal di RAM: tidak pernah ditulis ke LevelDB. Node yang restart
 * kehilangan tx pending (memang node-local), tetapi commit blok tidak lagi
 * membayar satu batch disk per admission.
 *
 * Dua Map: `transactions` untuk lookup `txHash`, `bySender` untuk indeks
 * per-pengirim (nonce/reserve/RBF). Keduanya selalu diperbarui bersama.
 */
const transactions = new Map<string, TxInterface>()
const bySender = new Map<string, Map<string, TxInterface>>()

const unindex = (txHash: string): void => {
	const tx = transactions.get(txHash)
	if (!tx) return
	transactions.delete(txHash)
	const from = tx.from
	if (!from) return
	const sender = bySender.get(from)
	if (!sender) return
	sender.delete(txHash)
	if (sender.size === 0) bySender.delete(from)
}

export const putMempoolTx = (tx: TxInterface): void => {
	const txHash = tx.txHash
	const from = tx.from
	if (!txHash || !from) return
	// Hash yang sama bisa datang lagi lewat jalur pemulihan; indeks lama harus
	// dilepas dulu supaya tidak tersisa di pengirim yang berbeda.
	unindex(txHash)
	transactions.set(txHash, tx)
	const sender = bySender.get(from)
	if (sender) sender.set(txHash, tx)
	else bySender.set(from, new Map([[txHash, tx]]))
}

export const deleteMempoolTx = (txHash: string): void => unindex(txHash)

export const getMempoolTx = (txHash: string): TxInterface | undefined =>
	transactions.get(txHash)

export const allMempoolTxs = (): TxInterface[] => [...transactions.values()]

export const senderMempoolTxs = (from: string): TxInterface[] => [
	...(bySender.get(from)?.values() ?? []),
]
