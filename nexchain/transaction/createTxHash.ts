/** @format */

import { TxInterface } from '../../interface/structTx'
import { sha256 } from '../block/sha256'
import { CHAIN_ID } from 'sign/chainId'

// Membuat hash dari data transaksi dengan nonce yang diberikan.
//
// Catatan:
//   - nonce IKUT di-hash supaya tidak bisa diganti setelah signing;
//   - chainId IKUT di-hash (EIP-155 di payload, bukan hanya di `v`): tanda
//     tangan terikat ke jaringan, sehingga transaksi dari jaringan lain tidak
//     bisa di-replay di sini (dan sebaliknya). Sesuai standar PoW Bitcoin,
//     hanya transaksi yang punya tanda tangan — blok tidak.
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
		chainId: CHAIN_ID,
	}
	const stringData = JSON.stringify(txData)
	const hash = sha256(stringData, 'hex')
	return `TxC${hash}`
}