import { Block } from 'src/core/block/blockModel'
import { meetsDifficulty } from 'src/core/consensus/difficulty'

/**
 * Verifikasi Proof-of-Work sebuah blok memakai **difficulty milik blok
 * itu sendiri** (`header.difficulty`, satuan bit zerodepan — lihat
 * `nexchain/miner/difficulty`).
 *
 * BUG (diperbaiki): target dulu di-hardcode `difficulty = 4` (prefix 4 digit
 * "0") sementara proses mining memakai prefix 5 digit — kriteria validasi
 * dan produksi berbeda, dan angka `header.difficulty` yang tersimpan tidak
 * pernah dipakai sama sekali.
 */
export const verifyPow = (block: Block): boolean => {
	const blockHash = block.block.header.hash
	if (!blockHash) {
		return false // Return false if hash is undefined or null
	}
	return meetsDifficulty(blockHash, block.block.header.difficulty)
}
