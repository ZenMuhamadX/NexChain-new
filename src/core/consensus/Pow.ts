import { sha256 } from 'src/core/encoding/sha256'

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
 */
export const hashWithNonce = (payload: string, nonce: number): string =>
	sha256(`${payload}${nonce}`, 'hex') as string