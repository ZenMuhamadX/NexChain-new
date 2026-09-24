import { getAccount } from 'account/balance/getAccount'
import { putAccount } from 'account/balance/putAccount'
import { structBalance } from 'interface/structBalance'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'

export const processReceiver = async (
	recieverAddress: string,
	amount: number,
) => {
	const oldData = await getAccount(recieverAddress).catch()
	if (!oldData) {
		const newData: structBalance = {
			address: recieverAddress,
			balance: amount,
			transactionCount: 1,
			isContract: false,
			lastTransactionDate: generateTimestampz(),
			// BUG-E2: akun baru mulai dari nonce 0, bukan 1. Nonce berarti
			// "jumlah transaksi keluaran yang sudah terkonfirmasi".
			nonce: 0,
		}
		await putAccount(recieverAddress, newData)
		return
	}
	const oldBalance = oldData?.balance as number
	const newData: structBalance = {
		address: recieverAddress,
		balance: oldBalance + amount,
		transactionCount: oldData?.transactionCount! + 1, // Mengupdate timesTransaction
		isContract: false,
		lastTransactionDate: generateTimestampz(),
		// BUG-E2 (diperbaiki): penerima TIDAK mengirim transaksi, jadi nonce
		// keluarannya tidak boleh berubah. Sebelumnya `oldData.nonce + 1`
		// membuat nonce berarti "transaksi masuk + keluar", padahal
		// validateTransactionNonce mengandalkan nonce = transaksi keluaran saja.
		// Akibatnya penerima yang tidak pernah mengirim bisa punya nonce > 0,
		// dan nonce terus berubah tiap menerima dana (lemah terhadap replay
		// bila digabung dengan hadiah blok yang mereset nonce ke 0).
		nonce: oldData.nonce ?? 0,
	}
	await putAccount(recieverAddress, newData)
}
