import { structBalance } from 'src/types/balance'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { loggingErr } from 'src/logging/errorLog'
import { getAccount } from 'src/core/state/account/getAccount'
import { putAccount } from 'src/core/state/account/putAccount'
import { hasSufficientBalance } from 'src/core/validation/module/hasSufficientBalance'
import { NonceMismatchError } from 'src/core/consensus/verify/module/verifyNonce'

export const processSender = async (
	senderAddress: string,
	amount: number,
	fee: number,
	txNonce: number,
	blockTimestamp: number,
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
		// lempar → `processTransact` TIDAK menangkap → `commitBlock`
		// membatalkan seluruh blok (rollback lewat journal). `!balanceStatus`
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
	// Lapis-2 urutan nonce. Pra-penerbangan `verifyBlockNonceOrder` (sebelum
	// WAL) sudah menegakkan aturan yang sama; assertion ini menangkap
	// divergensi antara pre-flight dan eksekusi — bug yang mengubah aturan
	// di SATU sisi saja. Gagal-dulu, sebelum `putAccount`.
	if (oldData.nonce !== txNonce) {
		throw new NonceMismatchError(senderAddress, oldData.nonce, txNonce)
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
		// Timestamp BLOK, bukan `Date.now()`: state harus deterministik di
		// semua node (syarat `stateRoot`).
		lastTransactionDate: blockTimestamp,
		nonce: txNonce + 1,
	}
	await putAccount(senderAddress, newData)
	// TIDAK ada pelepasan reserve di sini (Gelombang 2): reserve adalah
	// TURUNAN dari indeks mempool per-pengirim, dan ia dilepas saat tx keluar
	// dari mempool (`removeMemPool` di `processTransaction`), bukan saat
	// eksekusi. Menurunkan counter di sini adalah perilaku lama yang dihapus
	// bersama kunci `pendingBalance:<alamat>`.
}
