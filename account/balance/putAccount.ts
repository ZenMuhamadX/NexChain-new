import { loggingErr } from 'logging/errorLog'
import { structBalance } from 'interface/structBalance'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { rocksState } from 'nexchain/db/state'
import { stringToHex } from 'nexchain/hex/stringToHex'
import { HexString } from 'interface/structBlock'
import { assertNexuCapped } from 'nexchain/nexucoin/isNexuCapped'

/**
 * Updates the balance for a given address in RocksDB.
 * @param address - The address whose balance will be updated.
 * @param balance - The balance data to store.
 */
export const putAccount = async (
	address: string,
	balance: structBalance,
): Promise<void> => {
	// ---- GUARD FAIL-CLOSED — sengaja di LUAR try/catch -------------------
	// `handleUnexpectedError` di bawah MENELAN error lalu kembali normal,
	// sehingga guard yang diletakkan di dalam try hanya akan dicatat dan
	// state tetap tertulis dengan nilai rusak. Dilempar supaya memanggil
	// (`processSender`/`processReceiver`, keduanya di-catch per-transaksi
	// oleh `processTransact`) membatalkan transaksi alih-alih menyimpannya.
	//
	// Ini choke point TUNGGAL penulisan saldo: seluruh jalur — transfer,
	// kredit coinbase, pembuatan akun — melewati fungsi ini.
	// `balance?.balance` — input null/undefined harus menghasilkan pesan
	// guard yang jelas, bukan `TypeError: Cannot read properties of undefined`
	// yang bocor dari lapisan di atas.
	assertNexuCapped(balance?.balance, `putAccount(${address}).balance`)

	try {
		// Validate input
		if (!isValidInput(address, balance)) {
			logInvalidInputError()
			return
		}

		// Ensure timesTransaction is defined
		balance.transactionCount = balance.transactionCount ?? 0

		// Encode balance and save to RocksDB
		const encodedBalance = encodeBalanceData(balance)
		await saveToDB(address, encodedBalance)
	} catch (error) {
		handleUnexpectedError(error)
	}
}

/**
 * Validates the input for address and balance.
 * @param address - The address to validate.
 * @param balance - The balance object to validate.
 * @returns True if the input is valid, false otherwise.
 */
const isValidInput = (address: string, balance: structBalance): boolean => {
	return Boolean(address && balance)
}

/**
 * Logs an error when the input validation fails.
 */
const logInvalidInputError = (): void => {
	loggingErr({
		level: 'error',
		message: 'Error putting data or data not found',
		stack: new Error().stack!,
		hint: 'Address or balance is missing',
		timestamp: generateTimestampz(),
		priority: 'high',
		context: 'leveldb putBalance',
	})
}

/**
 * Encodes the balance data to a byte format.
 * @param balance - The balance object to encode.
 * @returns A hex containing the encoded balance data.
 */
const encodeBalanceData = (balance: structBalance): HexString => {
	return stringToHex(JSON.stringify(balance))
}

/**
 * Saves encoded balance data to RocksDB.
 * @param address - The address associated with the balance.
 * @param encodedBalance - The encoded balance data.
 */
const saveToDB = async (
	address: string,
	encodedBalance: HexString,
): Promise<void> => {
	await rocksState.put(address, encodedBalance, {
		sync: false, // Option for asynchronous write
	})
}

/**
 * Handles unexpected errors during the put operation.
 * @param error - The error that occurred.
 */
const handleUnexpectedError = (error: unknown): void => {
	console.error(error)
	loggingErr({
		level: 'error',
		message: 'Error putting data',
		timestamp: generateTimestampz(),
		priority: 'high',
		context: 'leveldb putBalance',
		stack: new Error().stack! as string,
		hint: 'An unexpected error occurred while putting data.',
	})
}
