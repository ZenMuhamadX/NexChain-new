import { transactionValidator } from 'src/core/validation/txValidator.v'
import { saveTxHistory } from 'src/core/transaction/saveTxHistory'
import { TxInterface } from 'src/types/transaction'
import { logToConsole } from 'src/logging/logging'
import {
	replaceMempool,
	saveMempool,
} from 'src/core/state/storage/mempool/saveMemPool'
import { getPendingReserve } from 'src/core/transaction/getPendingReserve'
import {
	countPendingBySender,
	findPendingByNonce,
	MAX_PENDING_PER_SENDER,
} from 'src/core/state/storage/mempool/mempoolIndex'
import { loadAllMempool } from 'src/core/state/storage/mempool/loadMempool'
import { getAccount } from 'src/core/state/account/getAccount'
import { formatStr } from 'src/core/encoding/lib/formatString'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'

/**
 * Antrean serial untuk ADMISSION transaksi (`addTransaction`).
 *
 * Nonce & reserve pending balance dihitung baca-tulis (baca mempool/pending
 * → … → tulis). Tanpa serialisasi, dua `nex_sendTransaction` dari pengirim
 * sama yang masuk bersamaan bisa:
 *   - lolos dengan NONCE SAMA (keduanya menghitung pendingCount sebelum tx
 *     pertama tersimpan), atau
 *   - reserve pending saling menimpa → over-admission melebihi saldo asli
 *     → saat eksekusi saldo kurang.
 * Satu antrean membuat seluruh admission atomik di dalam satu proses node.
 */
let admissionQueue: Promise<unknown> = Promise.resolve()

/**
 * Aturan bump RBF (KEBIJAKAN node, bukan konsensus): pengganti harus
 * ber-laju-fee LEBIH TINGGI dari tx yang digantikannya.
 *
 * MENGAPA laju (fee/byte) dan bukan fee: pengganti boleh lebih ramping
 * (angka fee ikut di-RLP, jadi ukurannya beda), sehingga fee yang sama belum
 * tentu laju yang sama. MENGAPA harus LEBIH TINGGI, bukan `>=`: dengan `>=`
 * tx identik (atau lebih besar tapi lebih lambat) bisa saling menggantikan
 * gratis — pool jadi papan pantul, dan tx besar bisa menghalau tx kecil.
 *
 * Perkalian silang `feeBaru·ukuranLama > feeLama·ukuranBaru`, bukan float.
 * shortcut: pada fee absurd produknya bisa > 2^53; efeknya hanya keputusan
 * terima/tolak satu tx, jadi tidak perlu BigInt di sini.
 */
const replacesFeeRate = (oldTx: TxInterface, newTx: TxInterface): boolean => {
	try {
		const oldSize = encodeTxPayload(oldTx).length
		const newSize = encodeTxPayload(newTx).length
		if (oldSize <= 0 || newSize <= 0) return false
		return (newTx.fee ?? 0) * oldSize > (oldTx.fee ?? 0) * newSize
	} catch {
		// tx lama tak ter-encode (data rusak) — tolak penggantian, fail-closed.
		return false
	}
}

export class MemPool {
	constructor() {
		logToConsole('MemPool initialized...')
	}

	/**
	 * Adds a transaction to the memory pool — diserialisasi lewat
	 * `admissionQueue` supaya nonce & reserve pending balance atomik
	 * terhadap admission lain yang masuk bersamaan.
	 * @param transaction - The transaction to be added.
	 * @returns True if the transaction was added successfully, otherwise false.
	 */
	public async addTransaction(
		transaction: TxInterface,
	): Promise<{ isValid: boolean; data?: TxInterface }> {
		const task = admissionQueue.then(() => this.doAddTransaction(transaction))
		admissionQueue = task.catch(() => undefined)
		return task
	}

	/** Body admission — hanya dijalankan dari dalam antrean serial. */
	private async doAddTransaction(
		transaction: TxInterface,
	): Promise<{ isValid: boolean; data?: TxInterface }> {
		const isValidTx = await transactionValidator(transaction)
		if (!isValidTx) {
			logToConsole('Transaction validation failed')
			return { isValid: isValidTx, data: transaction }
		}

		// Deteksi penggantian (RBF) SEBELUM cap per-pengirim: tx pengganti
		// MENEMPATI slot tx lama, jadi cap tidak boleh menolaknya.
		const replaced = await findPendingByNonce(
			transaction.from!,
			transaction.nonce,
		)
		if (replaced && !replacesFeeRate(replaced, transaction)) {
			logToConsole(
				`RBF ditolak: laju-fee pengganti tidak lebih tinggi dari ` +
					`${formatStr(replaced.txHash ?? '')}`,
			)
			return { isValid: false, data: transaction }
		}
		// shortcut: `fee <= amount` (validator) membatasi bump, dan cek saldo
		// keras di `transactionValidator` belum memperhitungkan cost tx lama
		// yang dilepas — pada saldo yang benar-benar habis pengganti bisa
		// ditolak lebih awal. Longgarkan bersama A4b.

		// Validate balance and update pending balance — semua pengirim
		// diperlakukan sebagai akun biasa (fitur smart contract dibuang).
		const isBalanceSufficient = await this.handleUserTransaction(
			transaction,
			replaced,
		)

		if (!isBalanceSufficient) return { isValid: false, data: transaction }

		// Save transaction to mempool and history — pengganti MENGGANTI tx
		// lama dalam satu batch atomik, bukan menambah entri kedua.
		if (replaced?.txHash) await replaceMempool(replaced.txHash, transaction)
		else await saveMempool(transaction)
		await saveTxHistory(transaction.txHash!, transaction)
		logToConsole(
			`Transaction added to mempool TxHash: ${formatStr(transaction.txHash!)}...`,
		)

		return { isValid: true, data: transaction }
	}

	/**
	 * Validasi keterjangkauan saldo terhadap reserve turunan.
	 *
	 * Reserve-nya TURUNAN dari indeks mempool per-pengirim
	 * (`getPendingReserve` = Σ(amount+fee) tx pending pengirim ini) — bukan
	 * kunci tersimpan. Karena itu admission ini TIDAK menulis reserve apa
	 * pun: `saveMempool` di bawah menulis tx BERSAMA entri indeksnya dalam
	 * SATU batch atomik, sehingga reserve berikutnya otomatis menyertakan
	 * transaksi ini. Keputusan terima/tolak tidak berubah — hanya sumber
	 * reserve yang berpindah dari counter ke turunan.
	 * @param transaction - User transaction.
	 * @returns True if balance is sufficient, otherwise false.
	 */
	private async handleUserTransaction(
		transaction: TxInterface,
		replaced?: TxInterface,
	): Promise<boolean> {
		// Cap per-pengirim (KEBIJAKAN node, bukan konsensus): tolak bila
		// pengirim sudah punya MAX_PENDING_PER_SENDER tx pending — SEBELUM
		// tx ke-17 diterima. Membatasi pindai prefix reserve dan mencegah
		// satu akun menghabiskan slot pool global. Node lain boleh memakai
		// batas berbeda tanpa fork (isi mempool memang node-local).
		// Tx pengganti (RBF) MENEMPATI slot tx lama — jumlah pending tidak
		// berubah, jadi cap tidak berlaku untuknya.
		if (!replaced) {
			const pendingCount = await countPendingBySender(transaction.from!)
			if (pendingCount >= MAX_PENDING_PER_SENDER) {
				logToConsole(
					`Mempool per-sender cap: ${formatStr(transaction.from!)} sudah punya ` +
						`${pendingCount} tx pending (batas ${MAX_PENDING_PER_SENDER}) — ditolak`,
				)
				return false
			}
		}

		const userBalance = await getAccount(transaction.from!)
		if (!userBalance) {
			logToConsole('Insufficient user balance')
			return false
		}

		const pendingReserve = await getPendingReserve(transaction.from!)
		// RBF melepas cost tx lama lebih dulu: reserve yang berlaku adalah
		// reserve TANPA tx itu — tanpa ini, saldo yang semula cukup untuk
		// pengganti bisa tampak kurang (tx lama + tx baru dihitung dua kali).
		const released = replaced ? (replaced.amount ?? 0) + (replaced.fee ?? 0) : 0
		const availableBalance =
			userBalance.balance - (pendingReserve.pendingAmount || 0) + released

		if (availableBalance < transaction.amount + (transaction.fee || 0)) {
			logToConsole('Insufficient user balance for the transaction')
			return false
		}

		return true
	}

	/**
	 * Retrieves all valid transactions in the memory pool.
	 * @returns An array of transactions.
	 */
	public async getValidTransactions(): Promise<TxInterface[]> {
		// Penuh (bukan 100): kandidat template harus LENGKAP supaya seleksi
		// berprioritas laju-fee bisa memilih di antara semua tx.
		return (await loadAllMempool()) as TxInterface[]
	}
}
