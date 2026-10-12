import { transactionValidator } from 'src/core/validation/txValidator.v'
import { saveTxHistory } from 'src/core/transaction/saveTxHistory'
import { TxInterface } from 'src/types/transaction'
import { logToConsole } from 'src/logging/logging'
import { saveMempool } from 'src/core/state/storage/mempool/saveMemPool'
import { getPendingBalance } from 'src/core/transaction/getPendingBalance'
import { setPendingBalance } from 'src/core/transaction/setPendingBalance'
import { loadMempool } from 'src/core/state/storage/mempool/loadMempool'
import { getAccount } from 'src/core/state/account/getAccount'
import { formatStr } from 'src/core/encoding/lib/formatString'

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

		// Validate balance and update pending balance — semua pengirim
		// diperlakukan sebagai akun biasa (fitur smart contract dibuang).
		const isBalanceSufficient = await this.handleUserTransaction(transaction)

		if (!isBalanceSufficient) return { isValid: false, data: transaction }

		// Save transaction to mempool and history
		await saveMempool(transaction)
		await saveTxHistory(transaction.txHash!, transaction)
		logToConsole(
			`Transaction added to mempool TxHash: ${formatStr(transaction.txHash!)}...`,
		)

		return { isValid: true, data: transaction }
	}

	/**
	 * Validates and updates pending balance for user transactions.
	 * @param transaction - User transaction.
	 * @returns True if balance is sufficient, otherwise false.
	 */
	private async handleUserTransaction(
		transaction: TxInterface,
	): Promise<boolean> {
		const userBalance = await getAccount(transaction.from!)
		if (!userBalance) {
			logToConsole('Insufficient user balance')
			return false
		}

		const pendingBalance = await getPendingBalance(transaction.from!)
		const availableBalance =
			userBalance.balance - (pendingBalance.pendingAmount || 0)

		if (availableBalance < transaction.amount + (transaction.fee || 0)) {
			logToConsole('Insufficient user balance for the transaction')
			return false
		}

		// Update pending balance
		await this.updatePendingBalance(
			transaction.from!,
			pendingBalance.pendingAmount,
			transaction,
		)
		return true
	}

	/**
	 * Updates the pending balance for a given address.
	 * @param address - The address to update.
	 * @param currentPending - The current pending balance.
	 * @param transaction - The transaction to update with.
	 */
	private async updatePendingBalance(
		address: string,
		currentPending: number | undefined,
		transaction: TxInterface,
	): Promise<void> {
		const newPendingAmount =
			(currentPending || 0) + transaction.amount + (transaction.fee || 0)
		await setPendingBalance({ address, pendingAmount: newPendingAmount })
	}

	/**
	 * Retrieves all valid transactions in the memory pool.
	 * @returns An array of transactions.
	 */
	public async getValidTransactions(): Promise<TxInterface[]> {
		return (await loadMempool()) as TxInterface[]
	}
}
