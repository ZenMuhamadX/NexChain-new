import { TxInterface } from 'interface/structTx'
import { stringToHex } from 'nexchain/hex/stringToHex'
import { createTxnHash } from './createTxHash'

/**
 * Sender khusus hadiah blok. Sengaja BUKAN format address (`NxC`/`NxS`),
 * sehingga tidak mungkin dimiliki pihak mana pun dan selalu terdeteksi di
 * `processTransact` sebelum cabang debit/credit normal berjalan.
 */
export const COINBASE_SENDER = 'COINBASE'

const COINBASE_MESSAGE = 'Block reward'

/**
 * Coinbase transaksi: satu-satunya sumber NXC baru pada blok produksi.
 *
 * Desain (mengganti `giveReward` / `putAccount` langsung):
 *   - Dimasukkan **pertama** ke `block.transactions`, sehingga jumlah hadiah
 *     ikut ter-commit di `merkleRoot` dan preimage PoW — hadiah tidak bisa
 *     diubah penambang tanpa membatalkan pekerjaannya;
 *   - Diproses lewat `processTransact` (branch `COINBASE_SENDER`): kredit ke
 *     saldo penambang + index riwayat `saveTxByAddress`/`saveTxHistory`,
 *     sehingga hadiah tampil sebagai transaksi normal di wallet & explorer;
 *   - Diletakkan di posisi pertama agar penambang bisa membelanjakan hadiah
 *     di blok yang sama (transaksi berikutnya melihat saldo sudah terkredit).
 *
 * `fee`/`nonce` 0 dan `sign` placeholder karena "COINBASE" bukan akun
 * pengirim — tidak ada kunci yang bisa menandatangani, dan tidak ada debit
 * yang perlu dilindungi. Field `r`/`s` tetap diisi non-kosong agar lolos
 * skema `verifyStruct`.
 */
export const createCoinbaseTx = (
	receiver: string,
	amount: number,
	timestamp: number,
): TxInterface => {
	const tx: TxInterface = {
		format: 'nexu',
		sender: COINBASE_SENDER,
		receiver,
		amount,
		timestamp,
		extraMessage: COINBASE_MESSAGE,
		fee: 0,
		nonce: 0,
		status: 'confirmed',
		isValid: true,
		isPending: false,
		hexInput: stringToHex(COINBASE_MESSAGE),
		sign: { v: 0, r: '0', s: '0' },
	}
	// txHash dihitung terakhir: createTxnHash memakai seluruh field di atas.
	tx.txHash = createTxnHash(tx)
	return tx
}
