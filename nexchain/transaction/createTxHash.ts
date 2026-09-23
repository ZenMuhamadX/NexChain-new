/** @format */

import { TxInterface } from '../../interface/structTx'
import { sha256 } from '../block/sha256'

// Membuat hash dari data transaksi dengan nonce yang diberikan.
// Catatan: nonce IKUT di-hash supaya tidak bisa diganti setelah signing.
export const createTxnHash = (data: TxInterface): string => {
	const txData = {
		sender: data.sender,
		receiver: data.receiver,
		amount: data.amount,
		extraMessage: data.extraMessage,
		timestamp: data.timestamp,
		format: 'nexu',
		fee: data.fee,
		nonce: data.nonce,
	}
	const stringData = JSON.stringify(txData)
	const hash = sha256(stringData, 'hex')
	return `TxC${hash}`
}
