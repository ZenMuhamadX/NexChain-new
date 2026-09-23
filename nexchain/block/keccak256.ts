import { keccak256 as keccak_256 } from 'js-sha3'

/**
 * Keccak-256 (js-sha3, pure JS -> aman di browser).
 * Menerima Uint8Array (jalur address) maupun string (jalur contract address).
 */
export const keccak256 = (input: Uint8Array | string): string => {
	return keccak_256(input)
}
