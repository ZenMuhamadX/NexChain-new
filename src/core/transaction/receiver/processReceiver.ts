import { getAccount } from 'src/core/state/account/getAccount'
import { putAccount } from 'src/core/state/account/putAccount'
import { structBalance } from 'src/types/balance'

export const processReceiver = async (
	recieverAddress: string,
	amount: number,
	blockTimestamp: number,
) => {
	// `getAccount` mengembalikan akun-nol semu untuk alamat valid yang belum
	// ada — jadi kredit pertama = penciptaan akun (seperti Ethereum), TANPA
	// cabang "akun baru" khusus. Sisa kasus di sini hanya alamat tidak valid
	// atau error baca DB; keduanya MELEMPAR (fail-closed) alih-alih menulis
	// akun dari nol — cabang lama bisa MENIMPA saldo penerima dengan `amount`.
	const oldData = await getAccount(recieverAddress).catch(() => undefined)
	if (!oldData) {
		throw new Error(
			`processReceiver: akun ${recieverAddress} tidak terbaca ` +
				`(alamat tidak valid atau error DB) — transaksi dibatalkan.`,
		)
	}
	const newData: structBalance = {
		address: recieverAddress,
		balance: oldData.balance + amount,
		transactionCount: (oldData.transactionCount ?? 0) + 1,
		// Timestamp BLOK, bukan `Date.now()` — state harus deterministik.
		lastTransactionDate: blockTimestamp,
		// BUG-E2: penerima TIDAK mengirim transaksi, jadi nonce keluarannya
		// tidak boleh berubah. Nonce = jumlah transaksi keluaran terkonfirmasi;
		// `oldData.nonce + 1` dulu membuat nonce berarti "masuk + keluar",
		// melemahkan anti-replay terhadap hadiah blok yang mereset nonce ke 0.
		nonce: oldData.nonce ?? 0,
	}
	await putAccount(recieverAddress, newData)
}
