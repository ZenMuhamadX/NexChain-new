/**
 * Penelusuran nenek moyang bersama (common ancestor) antara tip lokal dan
 * kandidat cabang dari branch pool.
 *
 * Untuk mengganti tip, kita harus tahu TITIK CABANG (`forkHeight`): height
 * blok lokal terakhir yang masih dipakai bersama kedua rantai. Cabang yang
 * menang adalah rantai blok pooled dari `forkHeight+1` sampai tip kandidat.
 *
 * Algoritma (Bitcoin-awal, cukup untuk kedalaman devnet):
 *   dari hash tip kandidat, telusuri `previousBlockHash` ke bawah SELAMA blok
 *   itu ada di pool; begitu hash-nya ditemukan di rantai lokal, itulah nenek
 *   moyang bersama. Bila rantai putus (hash tak ada di pool maupun lokal)
 *   atau ada siklus, cabang dianggap tak tersambung.
 *
 * Semua fungsi di sini READ-ONLY (kecuali tidak ada tulis sama sekali).
 * Penulisan tetap lewat `./reorg.ts` → `chains.commitBlock`.
 */
import type { Block } from 'src/core/block/blockModel'
import { getBlockByHash } from 'src/core/block/query/onChain/block/getBlockByHash'
import { getPooled, MAX_POOL_BLOCKS } from './branchPool'

/** Bentuk blok yang valid (penjaga tipis terhadap nilai rusak dari DB). */
const asBlock = (value: unknown): Block | undefined => {
	if (
		value !== null &&
		typeof value === 'object' &&
		'block' in value &&
		(value as Block).block !== null &&
		typeof (value as Block).block === 'object'
	) {
		return value as Block
	}
	return undefined
}

/**
 * Baca blok dari rantai LOKAL berdasarkan hash. `undefined` untuk apa pun
 * yang tidak ada / tidak terbaca — pemanggil tidak perlu try/catch.
 */
export const findLocalBlockByHash = async (
	hash: string,
): Promise<Block | undefined> => {
	if (typeof hash !== 'string' || hash.length === 0) return undefined
	try {
		return asBlock(await getBlockByHash(hash))
	} catch {
		return undefined
	}
}

/** Resolusi blok dari pool DULU, lalu rantai lokal. */
export const resolveBlock = async (
	hash: string,
): Promise<Block | undefined> => {
	const pooled = getPooled(hash)
	if (pooled) return pooled.block
	return findLocalBlockByHash(hash)
}

/** Hasil penelusuran: cabang naik dari `forkHeight+1` sampai tip kandidat. */
export interface TracedBranch {
	/** Height blok lokal terakhir yang dipakai bersama. */
	forkHeight: number
	/** Hash blok nenek moyang bersama (harus ada di rantai lokal). */
	forkHash: string
	/** Blok cabang urut menaik: `[forkHeight+1, …, tipHeight]`. */
	branch: Block[]
}

/**
 * Telusuri cabang yang berujung di `tipHash` (harus ada di pool) mundur ke
 * bawah sampai menemukan blok lokal. Mengembalikan `undefined` bila:
 *   - `tipHash` bukan blok pooled;
 *   - rantai putus sebelum mencapai blok lokal mana pun (cabang belum
 *     tersambung — mis. induknya belum tiba);
 *   - ada siklus (hash berulang);
 *   - kontinuitas height/tautan hash rusak (cabang tak sehat).
 */
export const traceBranchToLocal = async (
	tipHash: string,
): Promise<TracedBranch | undefined> => {
	const tip = getPooled(tipHash)
	if (!tip) return undefined

	const descent: Block[] = [] // dikumpulkan tip→bawah, dibalik di akhir
	const seen = new Set<string>()
	let currentHash = tipHash
	let iterations = 0

	while (true) {
		if (iterations++ > MAX_POOL_BLOCKS + 1) return undefined
		if (seen.has(currentHash)) return undefined // siklus
		seen.add(currentHash)

		const pooled = getPooled(currentHash)
		if (pooled) {
			descent.push(pooled.block)
			currentHash = pooled.prevHash
			continue
		}

		// Tidak ada di pool → harus blok lokal (nenek moyang bersama).
		const local = await findLocalBlockByHash(currentHash)
		if (!local) return undefined

		descent.reverse()
		// Validasi kontinuitas: height naik 1 dan prevHash menaut.
		let expectedHeight = local.block.height + 1
		let prevHash = local.block.header.hash
		for (const block of descent) {
			if (block.block.height !== expectedHeight) return undefined
			if (block.block.header.previousBlockHash !== prevHash) return undefined
			prevHash = block.block.header.hash
			expectedHeight++
		}

		return {
			forkHeight: local.block.height,
			forkHash: local.block.header.hash,
			branch: descent,
		}
	}
}
