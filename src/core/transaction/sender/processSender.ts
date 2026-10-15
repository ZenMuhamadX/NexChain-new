import { structBalance } from 'src/types/balance'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { loggingErr } from 'src/logging/errorLog'
import { getAccount } from 'src/core/state/account/getAccount'
import { putAccount } from 'src/core/state/account/putAccount'
import { hasSufficientBalance } from 'src/core/validation/module/hasSufficientBalance'

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
	// (hadiah blok + totalFees) — fee jadi tercetak dari nol tiap
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
	// TIDAK ada pelepasan reserve di sini (Gelombang 2): reserve adalah
	// TURUNAN dari indeks mempool per-pengirim, dan ia dilepas saat tx keluar
	// dari mempool (`removeMemPool` di `processTransaction`), bukan saat
	// eksekusi. Menurunkan counter di sini adalah perilaku lama yang dihapus
	// bersama kunci `pendingBalance:<alamat>`.
}
