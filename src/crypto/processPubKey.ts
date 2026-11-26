import { sha256 as jsSha256 } from 'js-sha256'
import { hexToBytes } from 'src/core/encoding/sha256'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { loggingErr } from 'src/logging/errorLog'
import { loggingDebug } from 'src/logging/debug'

/**
 * Decode blok 1000 tx memanggil `processPubKey` 1000 kali. Dua baris debug per
 * panggilan = 2000 `appendFileSync`, dan itu mengubah verifikasi jadi I/O
 * serial. Sama seperti geth/Bitcoin Core: event tetap dicatat, tapi produksinya
 * satu baris ringkas per operasi besar. Error per tx TIDAK diagregat.
 */
let batching = false
let batchCount = 0

export const withPubKeyBatch = <T>(
	label: string,
	txCount: number,
	run: () => T,
): T => {
	batching = true
	batchCount = 0
	const started = Date.now()
	try {
		return run()
	} finally {
		batching = false
		loggingDebug(
			'processPubKey',
			`${label}: ${txCount} tx, ${batchCount} ecrecover, ${Date.now() - started}ms`,
		)
	}
}

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
	if (batching) batchCount++
	else loggingDebug('processPubKey', 'Processing public key...')

	try {
		if (!isValidHexPublicKey(publicKey)) {
			logInvalidPublicKeyError(publicKey)
			return undefined
		}

		const hashedKey = generateSha256Hash(publicKey)
		if (!batching)
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
