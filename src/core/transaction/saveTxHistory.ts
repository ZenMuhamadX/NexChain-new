import { TxInterface } from 'src/types/transaction'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { bufferPut } from 'src/core/state/journal/writeBuffer'

interface savedHistory extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

export const saveTxHistory = async (txHash: string, txData: savedHistory) => {
	await bufferPut(
		'history',
		`txnHash:${txHash}`,
		stringToHex(JSON.stringify(txData)),
	)
}
