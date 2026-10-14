import { TxInterface } from 'src/types/transaction'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { rocksHistory } from 'src/core/state/db/history'
import { assertJournalAllows } from 'src/core/state/journal/guard'

interface savedHistory extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

export const saveTxHistory = async (txHash: string, txData: savedHistory) => {
	// Journal guard (fail-closed): kunci riwayat WAJIB terenumerasi.
	assertJournalAllows('history', `txnHash:${txHash}`)
	const stringData = JSON.stringify(txData)
	const encodedData = stringToHex(stringData)
	await rocksHistory.put(`txnHash:${txHash}`, encodedData, {
		sync: false,
	})
}
