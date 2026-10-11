import { TxInterface } from 'src/types/transaction'
import { sha256 } from 'src/core/encoding/sha256'

/**
 * Daun merkle untuk sebuah transaksi = `txHash`-nya.
 *
 * Sebelumnya daunnya adalah `txToString(tx)` =
 * `sender:receiver:amount:timestamp` — string turunan yang:
 *   - bergantung pada `timestamp` (yang kini dihapus, waktunya milik blok);
 *   - TIDAK mencakup `fee`, `nonce`, `data`, dan `sign`, sehingga merkle root
 *     tidak meng-commit transaksi secara utuh.
 *
 * Dengan `txHash` sebagai daun, merkle root meng-commit byte transaksi yang
 * sebenarnya — karena `txHash = sha256(payload bertipe)`.
 */
const leafOf = (tx: TxInterface): string => {
	if (!tx.txHash) {
		throw new Error('createMerkleRoot: transaksi tanpa txHash')
	}
	return tx.txHash
}

/** Merkle root dari daftar transaksi (daun = `txHash`). */
export const createMerkleRoot = (transactions: TxInterface[]): string => {
	if (transactions.length === 0) {
		return sha256('', 'hex') as string
	}

	let transactionHashes: string[] = transactions.map(leafOf)

	while (transactionHashes.length > 1) {
		const tempHashes: string[] = []

		if (transactionHashes.length % 2 !== 0) {
			transactionHashes.push(transactionHashes[transactionHashes.length - 1])
		}

		for (let i = 0; i < transactionHashes.length; i += 2) {
			const combinedHash: string = sha256(
				transactionHashes[i] + transactionHashes[i + 1],
				'hex',
			) as string
			tempHashes.push(combinedHash)
		}

		transactionHashes = tempHashes
	}

	return transactionHashes[0]
}
