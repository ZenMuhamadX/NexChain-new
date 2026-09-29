import { processPubKey } from 'account/utils/processPubKey'
import { keccak256 } from 'nexchain/block/keccak256'

/**
 * Generate wallet address dari public key.
 *
 * Alur (identik dengan versi lama yang pakai Buffer, tapi tanpa Node API):
 *   1. sha256(pubkey bytes)
 *   2. prepend version byte 0x00
 *   3. keccak256 -> 40 char terakhir -> "NxC..."
 */
export const generateAddressFromPublicKey = (publicKey: string): string => {
	const hashed = processPubKey(publicKey)
	if (!hashed) {
		throw new Error('Invalid public key for address generation')
	}

	// Gabungkan version byte (0x00) + hash  ->  pengganti Buffer.concat
	const versionAddress = new Uint8Array(hashed.length + 1)
	versionAddress[0] = 0x00
	versionAddress.set(hashed, 1)

	return `NxC${keccak256(versionAddress).slice(-40)}`
}
