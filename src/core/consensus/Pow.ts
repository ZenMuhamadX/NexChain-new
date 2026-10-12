import {
	sha256,
	createPowHasher as createPowHasherImpl,
	PowHasher,
} from 'src/core/encoding/sha256'

/**
 * Hash PoW = SHA-256(preimage || nonce) dalam hex.
 *
 * `preimage` HARUS `prepareBlockForHashing(block)` — preimage yang sama
 * dipakai `verifyBlockHash` dan yang diterima node lewat `nex_getWork`.
 * Fungsi ini murni (hanya js-sha256), aman dipakai miner eksternal.
 *
 * Node tidak lagi memiliki loop PoW in-process (dulu `proofOfWork`, hanya
 * dipakai genesis lama yang di-generate) — genesis kini hardcoded
 * (`nexchain/block/genesis.ts`), dan blok produksi di-mine oleh miner
 * eksternal via `nex_getWork`/`nex_submitWork` supaya event loop node
 * tidak pernah freeze dan RPC tetap hidup selama mining.
 *
 * Catatan performa: ini jalur KONVENIEN (satu hash). Untuk loop mining yang
 * mengevaluasi banyak nonce atas payload yang sama, pakai
 * `createPowHasher(payload)` — hasilnya identik tetapi jauh lebih cepat
 * karena payload hanya di-encode sekali (lihat `encoding/sha256.ts`).
 */
export const hashWithNonce = (payload: string, nonce: number): string =>
	sha256(`${payload}${nonce}`, 'hex') as string

/**
 * Hasher PoW ber-payload-tetap untuk loop mining.
 *
 * `hasher.hash(nonce)` byte-per-byte identik dengan `hashWithNonce(payload,
 * nonce)` — dibuktikan gate `scripts/powParityCheck.ts`.
 *
 * Contoh:
 *   const hasher = createPowHasher(work.payload)
 *   for (let nonce = 0; ; nonce++) {
 *     if (meetsDifficulty(hasher.hash(nonce), work.difficulty)) break
 *   }
 */
export const createPowHasher = (payload: string): PowHasher =>
	createPowHasherImpl(payload)

export type { PowHasher }
