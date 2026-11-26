/**
 * Indeks metadata header blok di RAM — model `CBlockIndex` Bitcoin.
 *
 * Bitcoin tidak pernah memuat badan blok untuk membaca timestamp/difficulty/
 * induk: `CBlockIndex` menyimpan header saja, dan MTP-11 dibaca dari sana.
 * Di sini alasannya lebih tajam: badan blok berisi 1000 transaksi, dan
 * mendekodenya berarti `ecrecover` untuk setiap tx. `getPreviousTimestamps`,
 * anchor verifikasi inkremental, dan pemeriksaan induk saat commit hanya butuh
 * empat field header, jadi mereka memakai cache ini, bukan blok penuh.
 *
 * Cache ini MEMOIZASI, bukan sumber kebenaran: diisi dari blok yang benar-benar
 * dibaca dari DB, ditimpa saat blok di-commit, dan dibatalkan bersama marker
 * verifikasi lewat hook R-1 (`invalidateFrom`). Isi yang basi tidak pernah
 * dipakai untuk memverifikasi ulang blok — konsensus tetap membaca blok penuh.
 */
import type { Block } from 'src/core/block/blockModel'
import { getBlockByHeight } from './getBlockByHeight'

export interface BlockHeaderInfo {
	hash: string
	previousBlockHash: string
	timestamp: number
	difficulty: number
	stateRoot: string
}

const headers = new Map<number, BlockHeaderInfo>()

const fromBlock = (block: Block): BlockHeaderInfo => ({
	hash: block.block.header.hash,
	previousBlockHash: block.block.header.previousBlockHash,
	timestamp: block.block.header.timestamp,
	difficulty: block.block.header.difficulty,
	stateRoot: block.block.header.stateRoot,
})

/** Header dari cache; kalau belum ada, baca blok sekali lalu simpan. */
export const getBlockHeader = async (
	height: number,
): Promise<BlockHeaderInfo | undefined> => {
	const cached = headers.get(height)
	if (cached !== undefined) return cached
	const block = (await getBlockByHeight(height)) as Block | undefined
	if (block === undefined) return undefined
	const info = fromBlock(block)
	headers.set(height, info)
	return info
}

/** Simpan header blok yang baru saja berhasil di-commit (tanpa decode). */
export const rememberBlockHeader = (block: Block): void => {
	headers.set(block.block.height, fromBlock(block))
}

/** R-1: buang header turunan tip yang diganti reorg/rollback. */
export const invalidateBlockHeadersFrom = (height: number): void => {
	for (const h of headers.keys()) {
		if (h >= height) headers.delete(h)
	}
}

/** Bersihkan seluruh cache (uji / reset state). */
export const resetBlockHeaderCache = (): void => {
	headers.clear()
}
