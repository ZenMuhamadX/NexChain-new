import { sha256 as jsSha256 } from 'js-sha256'
import { hexToBytes } from 'nexchain/block/sha256'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import { loggingErr } from 'logging/errorLog'
import { loggingDebug } from 'logging/debug'

/**
 * Processes a public key and generates its SHA256 hash.
 * @param publicKey - The public key in hexadecimal string format.
 * @returns The SHA256 hash of the public key as a Uint8Array, or undefined if an error occurs.
 *
 * Catatan: sebelumnya memakai Node `crypto` (gagal di browser) dan Buffer.
 * Sekarang pure-JS -> aman dipakai di browser wallet.
 * Hasilnya identik dengan crypto.createHash('sha256').update(bytes).digest().
 */
export const processPubKey = (publicKey: string): Uint8Array | undefined => {
	loggingDebug('processPubKey', 'Processing public key...')

	try {
		if (!isValidHexPublicKey(publicKey)) {
			logInvalidPublicKeyError(publicKey)
			return undefined
		}

		const hashedKey = generateSha256Hash(publicKey)
		loggingDebug('processPubKey', 'Successfully processed public key.')
		return hashedKey
	} catch (error) {
		logProcessingError(error)
		return undefined
	}
}

/**
 * Validates if the provided public key is a valid hexadecimal string.
 * @param publicKey - The public key to validate.
 * @returns True if public key is valid, false otherwise.
 */
const isValidHexPublicKey = (publicKey: string): boolean => {
	return typeof publicKey === 'string' && /^[0-9a-fA-F]+$/.test(publicKey)
}

/**
 * Logs an error when an invalid public key is detected.
 * @param publicKey - The invalid public key.
 */
const logInvalidPublicKeyError = (publicKey: string): void => {
	loggingErr({
		context: 'processPubKey',
		level: 'error',
		priority: 'high',
		hint: 'Invalid public key',
		message: `Invalid public key format. Received: "${publicKey}". Must be a hexadecimal string.`,
		stack: new Error().stack!,
		timestamp: generateTimestampz(),
	})
}

/**
 * Generates a SHA256 hash from a public key.
 * @param publicKey - The public key in hexadecimal string format.
 * @returns The SHA256 hash as a Uint8Array.
 */
const generateSha256Hash = (publicKey: string): Uint8Array => {
	// hex -> bytes -> sha256 -> bytes (identik dengan versi Node crypto)
	return hexToBytes(jsSha256(hexToBytes(publicKey)))
}

/**
 * Logs an error when there is an exception during the public key processing.
 * @param error - The caught error object.
 */
const logProcessingError = (error: unknown): void => {
	loggingErr({
		context: 'processPubKey',
		level: 'error',
		priority: 'high',
		hint: 'Error processing public key',
		message: error instanceof Error ? error.message : 'Unknown error',
		stack: error instanceof Error ? error.stack! : new Error().stack!,
		timestamp: generateTimestampz(),
	})
}
