/**
 * Fork-choice MURNI: ubah difficulty menjadi "kerja" dan jumlahkan.
 *
 * Aturan pemilihan cabang mengikuti Bitcoin: **bukan** tinggi terpanjang,
 * melainkan **kerja kumulatif terbanyak** (`sum of 2^difficulty`). Dengan
 * retarget per blok, dua cabang berbeda panjang belum tentu berbeda kerja,
 * jadi membandingkan `height` saja salah. Modul ini menyediakan primitif
 * murni untuk perbandingan itu; keputusan + eksekusi reorg ada di
 * `./reorg.ts`.
 *
 * ## Kenapa `2^(bits - MIN)` dan bukan `2^bits`
 *
 * Kita hanya perlu URUTAN, bukan nilai absolut. Mengukur relatif terhadap
 * `MIN_DIFFICULTY_BITS` menjaga eksponen tetap kecil (0..160 untuk
 * bit 8..48). `difficulty` di-quantize ke 0.25 bit, jadi eksponennya bulat
 * bila dikali 4 — semuanya `BigInt`, tanpa float sama sekali.
 *
 * Modul ini SENGAJA murni (tanpa DB/model) supaya bisa diuji tanpa LevelDB
 * dan dipakai ulang di gate `check:reorg` / `check:p2p`.
 */
import type { Block } from 'src/core/block/blockModel'
import { clampDifficulty, MIN_DIFFICULTY_BITS } from 'src/core/consensus/difficulty'

/**
 * Kerja satu blok pada difficulty `bits`, sebagai `BigInt`.
 *
 * `work = 2^(bits*4 - MIN*4)` — relatif terhadap `MIN_DIFFICULTY_BITS`,
 * monoton naik terhadap difficulty (0.25 bit ≈ ×1.19 kerja). `bits` di-clamp
 * lebih dulu, jadi nilai di luar [MIN, MAX] tidak merusak urutan.
 */
export const difficultyToWork = (bits: number): bigint => {
	const clamped = clampDifficulty(bits)
	const exp = Math.round(clamped * 4) - MIN_DIFFICULTY_BITS * 4
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
