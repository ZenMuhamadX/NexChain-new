import { TxInterface } from 'src/types/transaction'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { rocksHistory } from 'src/core/state/db/history'

interface savedHistory extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

export const saveTxHistory = async (txHash: string, txData: savedHistory) => {
	const stringData = JSON.stringify(txData)
	const encodedData = stringToHex(stringData)
	await rocksHistory.put(`txnHash:${txHash}`, encodedData, {
		sync: false,
	})
}
