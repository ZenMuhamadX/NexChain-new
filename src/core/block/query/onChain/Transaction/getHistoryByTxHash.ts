import { TxInterface } from 'src/types/transaction'
import { hexToString } from 'src/core/encoding/hex/hexToString'
import { HexString } from 'src/types/block'
import { decodeFromBytes } from 'src/core/encoding/hex/bytes/decodeBytes'
import { rocksHistory } from 'src/core/state/db/history'

export const getHistoryByTxHash = async (
	txHash: string,
	enc: 'hex' | 'json',
): Promise<TxInterface | HexString> => {
	const data: Buffer = (await rocksHistory.get(`txnHash:${txHash}`, {
		fillCache: true,
	})) as Buffer
	const decodedData = hexToString(decodeFromBytes(data) as HexString)
	if (enc === 'json') return JSON.parse(decodedData)
	return decodeFromBytes(data) as HexString
}
