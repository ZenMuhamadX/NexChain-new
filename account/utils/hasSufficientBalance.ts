import { loggingErr } from 'logging/errorLog'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { logToConsole } from 'logging/logging'
import { getAccount } from '../balance/getAccount'

/**
 * Checks if the provided address has sufficient balance.
 *
 * Cabang pemeriksaan saldo KONTRAK dihapus bersama fitur smart contract —
 * semua alamat kini dicek sebagai akun biasa.
 * @param address - The address to check balance for.
 * @param amount - The transaction amount.
 * @param fee - The transaction fee.
 * @returns True if balance is sufficient, false if insufficient, or undefined if an error occurs.
 */
export const hasSufficientBalance = async (
	address: string,
	amount: number,
	fee: number,
): Promise<boolean | undefined> => {
	if (!address) {
		logToConsole('Address not provided')
		return false
	}

	try {
		return await checkStandardBalance(address, amount, fee)
	} catch (error) {
		handleBalanceCheckError(error)
		return undefined
	}
}

/**
 * Checks if a standard address has sufficient balance.
 * @param address - The standard wallet address.
 * @param amount - The transaction amount.
 * @param fee - The transaction fee.
 * @returns True if balance is sufficient, false otherwise.
 */
const checkStandardBalance = async (
	address: string,
	amount: number,
	fee: number,
): Promise<boolean> => {
	const balance = await getAccount(address)
	if (!balance) {
		logToConsole('Balance not found')
		return false
	}

	if (balance.balance >= amount + fee) {
		return true
	} else {
		logToConsole('Insufficient balance')
		return false
	}
}

/**
 * Logs an error when an exception occurs during balance checks.
 * @param error - The error object.
 */
const handleBalanceCheckError = (error: any): void => {
	console.error(error)
	loggingErr({
		context: 'hasSufficientBalance',
		message: 'Balance check failed',
		stack: new Error().stack!,
		timestamp: generateTimestampz(),
		level: 'error',
		priority: 'high',
	})
}
