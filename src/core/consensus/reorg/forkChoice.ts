/**
 * Fork-choice MURNI: ubah difficulty menjadi "kerja" dan jumlahkan.
 *
 * Aturan pemilihan cabang mengikuti Bitcoin: **bukan** tinggi terpanjang,
 * melainkan **kerja kumulatif terbanyak**. Dengan retarget per blok, dua
 * cabang berbeda panjang belum tentu berbeda kerja, jadi membandingkan
 * `height` saja salah. Sejak fork `bits`, `header.difficulty` adalah compact
 * target; ia diterjemahkan ke bit nol depan dulu sebelum dihitung.
 *
 * ## Kenapa relatif terhadap difficulty minimum
 *
 * Kita hanya perlu URUTAN, bukan nilai absolut. Mengukur relatif terhadap
 * difficulty minimum menjaga eksponen tetap kecil, dan pembulatan ke 0.25 bit
 * membuatnya bulat bila dikali 4 — semuanya `BigInt`, tanpa float di sini.
 *
 * Modul ini SENGAJA murni (tanpa DB/model) supaya bisa diuji tanpa LevelDB
 * dan dipakai ulang di gate `check:reorg` / `check:p2p`.
 */
import type { Block } from 'src/core/block/blockModel'
import {
	bitsToDifficulty,
	MIN_DIFFICULTY_BITS,
} from 'src/core/consensus/difficulty'

/**
 * Kerja satu blok pada difficulty `bits`, sebagai `BigInt`.
 *
 * `work = 2^(diff*4 - MIN*4)` — relatif terhadap difficulty minimum,
 * monoton naik (0.25 bit ≈ ×1.19 kerja). Compact bits yang invalid jatuh ke
 * difficulty minimum, jadi tidak merusak urutan.
 */
export const difficultyToWork = (bits: number): bigint => {
	const difficulty = Math.max(
		8,
		Math.min(48, Math.round(bitsToDifficulty(bits) * 4) / 4),
	)
	const exp =
		Math.round(difficulty * 4) -
		Math.round(bitsToDifficulty(MIN_DIFFICULTY_BITS) * 4)
	if (exp <= 0) return 1n
	return 1n << BigInt(exp)
}

/** Kerja satu blok (dari `header.difficulty`-nya). */
export const blockWork = (block: Block): bigint =>
	difficultyToWork(block.block.header.difficulty)

/** Jumlahkan kerja seluruh blok dalam sebuah segmen rantai. */
export const sumWork = (blocks: Block[]): bigint => {
	let total = 0n
	for (const block of blocks) total += blockWork(block)
	return total
}

/** Bandingkan dua nilai kerja: -1 | 0 | 1 (aman untuk `BigInt`). */
export const compareWork = (a: bigint, b: bigint): -1 | 0 | 1 =>
	a < b ? -1 : a > b ? 1 : 0
