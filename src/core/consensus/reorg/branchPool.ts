/**
 * Branch pool: penampung SEMENTARA blok asing yang belum menempel ke tip
 * lokal (kandidat cabang), sampai rantainya tersambung ke nenek moyang lokal
 * atau terbukti menang.
 *
 * Modelnya seperti "orphan pool" Bitcoin-awal, tapi lebih sempit: kita tidak
 * mengejar blok yatim tak terbatas. Setiap blok yang diterima lewat P2P dan
 * TIDAK menempel ke tip (melainkan ke hash lain) disimpan di sini; setelah
 * penambahan, pemanggil (`src/p2p/validation/connectBlock.ts`) memanggil
 * `reevaluateBranches()` di `./reorg.ts` untuk mencari cabang terberat yang
 * tersambung ke rantai lokal.
 *
 * ## In-memory, sengaja
 *
 * Pool ini state turunan yang murah dibangun ulang: peer akan mengirim ulang
 * bloknya setelah restart, dan kandidat yang kalah tidak perlu bertahan.
 * Menyimpannya di LevelDB akan menambah store ke-7 yang harus di-rollback
 * saat reorg — persis kompleksitas yang ingin dihindari. Jadi: memori saja,
 * dengan batas jumlah agar input nakal tidak menghabiskan RAM.
 *
 * ## Batas (`MAX_POOL_BLOCKS`)
 *
 * Saat penuh, entri dengan height TERENDAH dibuang lebih dulu. Basis cabang
 * yang terlalu dalam tetap tak berguna (tak bisa menang melewati
 * `MAX_REORG_DEPTH`), dan mempertahankan blok dekat-tip membuat cabang yang
 * masih layak tetap dapat ditelusuri.
 *
 * Modul ini murni state in-memory (tanpa I/O) tetapi membaca bentuk `Block`,
 * sehingga tidak boleh diimpor `src/core/**` lain di luar modul reorg tanpa
 * sadar bahwa ini state global proses.
 */
import type { Block } from 'src/core/block/blockModel'
import { blockWork } from './forkChoice'

/** Satu blok yang diparkir di pool. */
export interface PooledBlock {
	block: Block
	hash: string
	height: number
	prevHash: string
	/** Kerja blok ini sendiri (bukan kumulatif). */
	work: bigint
}

/**
 * Batas jumlah blok di pool. Cukup untuk beberapa cabang devnet dalam
 * `MAX_REORG_DEPTH`, tetapi menjaga RAM bila peer mengirim ribuan blok yang
 * tak pernah tersambung.
 */
export const MAX_POOL_BLOCKS = 512

const pool = new Map<string, PooledBlock>()

/** Kosongkan pool (dipakai reorg selesai + uji). */
export const resetBranchPool = (): void => {
	pool.clear()
}

/** Jumlah blok yang saat ini diparkir. */
export const poolSize = (): number => pool.size

/** Ambil satu blok pooled berdasarkan hash (atau `undefined`). */
export const getPooled = (hash: string): PooledBlock | undefined =>
	pool.get(hash)

/** Apakah hash ini ada di pool. */
export const hasPooled = (hash: string): boolean => pool.has(hash)

/** Salinan seluruh isi pool (dipakai uji / diagnostik). */
export const listPooled = (): PooledBlock[] => [...pool.values()]

const evictLowestHeight = (): void => {
	let victim: PooledBlock | undefined
	for (const entry of pool.values()) {
		if (!victim || entry.height < victim.height) victim = entry
	}
	if (victim) pool.delete(victim.hash)
}

/**
 * Parkir satu blok yang sudah lolos validasi konsensus. Idempoten: blok
 * dengan hash yang sudah ada tidak ditimpa. Mengembalikan entri yang berlaku.
 */
export const addToPool = (block: Block): PooledBlock | undefined => {
	const hash = block.block?.header?.hash
	if (typeof hash !== 'string' || hash.length === 0) return undefined

	const existing = pool.get(hash)
	if (existing) return existing

	const entry: PooledBlock = {
		block,
		hash,
		height: block.block.height,
		prevHash: block.block.header.previousBlockHash,
		work: blockWork(block),
	}
	pool.set(hash, entry)
	if (pool.size > MAX_POOL_BLOCKS) evictLowestHeight()
	return entry
}

/** Buang satu blok dari pool. Mengembalikan `true` bila memang ada. */
export const removePooled = (hash: string): boolean => pool.delete(hash)

/**
 * Buang semua entri dengan `height <= height` (blok yang kini sudah lokal
 * setelah reorg, atau cabang yang sudah tak relevan).
 */
export const prunePoolAtOrBelow = (height: number): number => {
	let removed = 0
	for (const entry of pool.values()) {
		if (entry.height <= height) {
			pool.delete(entry.hash)
			removed++
		}
	}
	return removed
}

/**
 * Buang semua entri dengan `height >= height`.
 *
 * Inilah implementasi hook **R-1 `invalidateFrom(height)`**: saat tip lokal
 * berubah, SEMUA state turunan ber-key height/hash >= titik cabang menjadi
 * basi. Untuk sekarang yang ada hanyalah branch pool; bila kelak muncul marker
 * verifikasi hash-keyed (mis. `verifiedUpTo`), ia WAJIB dibersihkan di sini
 * juga — satu titik, bukan tersebar.
 */
export const prunePoolAtOrAbove = (height: number): number => {
	let removed = 0
	for (const entry of pool.values()) {
		if (entry.height >= height) {
			pool.delete(entry.hash)
			removed++
		}
	}
	return removed
}
