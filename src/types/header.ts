export interface header {
	previousBlockHash: string
	timestamp: number // Changed to number for better efficiency (UNIX timestamp)
	hash: string
	nonce: number
	version: string
	difficulty: number
	hashingAlgorithm: string // Optional, in case you want flexibility in hashing algorithms
	/**
	 * Komitmen state SETELAH blok ini dieksekusi (akumulator, lihat
	 * `src/core/state/root.ts`). Ikut preimage PoW: penambang tidak bisa
	 * mengganti klaim state tanpa mengulang PoW, dan setiap node bisa
	 * membuktikan state-nya tidak diubah tangan dengan replay.
	 */
	stateRoot: string
}
