import { structBalance } from 'interface/structBalance'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { loggingErr } from 'logging/errorLog'
import { getPendingBalance } from '../getPendingBalance'
import { setPendingBalance } from '../setPendingBalance'
import { getAccount } from 'account/balance/getAccount'
import { putAccount } from 'account/balance/putAccount'
import { hasSufficientBalance } from 'account/utils/hasSufficientBalance'

export const processSender = async (
	senderAddress: string,
	amount: number,
	fee: number,
) => {
	const balanceStatus = await hasSufficientBalance(senderAddress, amount, fee)
	if (!balanceStatus) {
		loggingErr({
			message: 'Insufficient balance',
			stack: new Error().stack!,
			hint: 'Insufficient balance',
			timestamp: generateTimestampz(),
			level: 'error',
			priority: 'high',
			context: 'leveldb processTransaction',
		})
		// Dulu: `return` diam-diam — `processTransact` lanjut ke
		// `processReceiver` → penerima dikredit TANPA pengirim didebet
		// (uang tercetak), lalu transaksi malah dikonfirmasi. Sekarang:
		// lempar → ditangkap catch per-tx → transaksi TETAP di mempool dan
		// dicoba lagi di blok berikutnya (gagal-aman). `!balanceStatus`
		// juga menangani `undefined` (error baca saldo) — ikut ditolak.
		throw new Error(
			`Insufficient balance: ${senderAddress} (amount=${amount}, fee=${fee})`,
		)
	}

	// Ambil data saldo saat ini — gagal baca harus MELEMPAR (bukan lanjut
	// dengan saldo undefined/NaN yang menuliskan state rusak).
	const oldData = await getAccount(senderAddress)
	if (!oldData) {
		throw new Error(`Sender account not found: ${senderAddress}`)
	}
	// Fee IKUT didebet: selama ini fee hanya DICEK di validasi tapi tidak
	// pernah ditarik, sementara coinbase membayarkan total fee ke miner
	// (reward + gasPrice + totalFees) — fee jadi tercetak dari nol tiap
	// blok. Dengan debit `amount + fee`, modelnya jadi fee-transfer yang
	// konsisten: pengirim −(amount+fee), penerima +amount, miner +fee.
	const calculateBalance = oldData.balance - (amount + fee)
	const newData: structBalance = {
		address: senderAddress,
		balance: calculateBalance,
		transactionCount: oldData.transactionCount + 1,
		isContract: false,
		lastTransactionDate: generateTimestampz(),
		nonce: oldData.nonce + 1,
	}
	await putAccount(senderAddress, newData)
	// Ambil dan perbarui pending balance
	const pendingBalance = await getPendingBalance(senderAddress)
	const updatedPendingAmount =
		(pendingBalance.pendingAmount || 0) - (amount + fee)
	await setPendingBalance({
		address: senderAddress,
		pendingAmount: Math.max(updatedPendingAmount, 0),
	})
}
