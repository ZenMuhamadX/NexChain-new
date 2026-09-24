import { prepareBlockForHashing } from 'nexchain/block/prepareBlock'
import { Block } from 'nexchain/model/block/block'
import { sha256 } from 'nexchain/block/sha256'
import { meetsDifficulty } from './difficulty'

/**
 * Hash PoW = SHA-256(preimage || nonce) dalam hex.
 *
 * `preimage` HARUS `prepareBlockForHashing(block)` — preimage yang sama
 * dipakai `verifyBlockHash` dan yang diterima node lewat `nex_getWork`.
 * Fungsi ini murni (hanya js-sha256), aman dipakai miner eksternal.
 */
export const hashWithNonce = (payload: string, nonce: number): string =>
	sha256(`${payload}${nonce}`, 'hex') as string

/**
 * Jalankan loop PoW in-process terhadap difficulty `header.difficulty` blok.
 *
 * KINI HANYA untuk **genesis** (sekali, saat rantai kosong). Blok produksi
 * TIDAK lagi di-mine di sini: node menyusun template + membagi job lewat
 * `nex_getWork` / `nex_submitWork`, dan miner eksternal
 * (`client/miner/runMiner.ts`) yang menghitung PoW lewat HTTP — supaya
 * event loop node tidak pernah freeze dan RPC tetap hidup selama mining.
 *
 * Kriteria kesulitan dulu di-hardcode ('00000') terpisah dari verifikasi
 * (verifyPow memakai '0000') — keduanya kini memakai `meetsDifficulty`
 * dengan `header.difficulty` sebagai satu-satunya sumber kebenaran.
 */
export const proofOfWork = (block: Block): { nonce: number; hash: string } => {
	const payload = prepareBlockForHashing(block)
	const difficulty = block.block.header.difficulty

	let nonce = 0
	let hash = hashWithNonce(payload, nonce)
	while (!meetsDifficulty(hash, difficulty)) {
		nonce++
		hash = hashWithNonce(payload, nonce)
	}
	return { nonce, hash }
}
