import { sha256 } from 'nexchain/block/sha256'

/**
 * Hash sebuah pesan (txHash / block hash) dengan SHA-256.
 * Hasilnya Uint8Array (bukan Buffer) supaya bisa dipakai di browser
 * dan tetap diterima elliptic untuk sign / recover.
 */
export const hashMessage = (data: string): Uint8Array => {
	return sha256(data, 'buffer') as Uint8Array
}
