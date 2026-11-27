/**
 * Difficulty Proof-of-Work NexChain — compact `bits` ala Bitcoin.
 *
 * `header.difficulty` adalah uint32: 1 byte eksponen + 23 bit mantissa,
 * `target = mantissa × 2^(8·(eksponen−3))`. Hash 64-hex (big-endian) lolos
 * bila `hash <= target`. Ini menggantikan bilangan desimal "bit nol depan"
 * (langkah 0.25) yang dulu dipakai rantai lama; perubahan ini fork dan
 * semua hash/genesis berubah.
 *
 * Retarget tetap memakai satuan bit pecahan di dalam (langkah +2/−4/−8,
 * jepit [8,48]) supaya perilaku jaringan tidak berubah — hanya penyimpanan
 * dan perbandingannya yang sekarang memakai compact target. Semua fungsi
 * di sini murni supaya bisa dipakai node, verifier, dan tooling tanpa I/O.
 */
export const TARGET_BLOCK_TIME_MS = 60_000

const MAX_TARGET = (1n << 256n) - 1n
const MIN_FRACTIONAL_BITS = 8
const MAX_FRACTIONAL_BITS = 48
const QUANTUM_BITS = 0.25
const MAX_RISE_BITS = 2
const MAX_FALL_BITS = 4
const MAX_STALL_FALL_BITS = 8

/** Eksponen/mantissa dari compact bits; `undefined` bila tidak valid. */
const splitCompact = (
	bits: number,
): { exponent: number; mantissa: number } | undefined => {
	if (!Number.isSafeInteger(bits) || bits < 0 || bits > 0xffffffff)
		return undefined
	const exponent = Math.floor(bits / 0x1000000)
	const mantissa = bits % 0x800000
	// Bit tanda (0x800000) bukan mantissa; eksponen 3..32 menutup difficulty
	// 48..8 bit yang dipakai rantai ini.
	if ((bits & 0x800000) !== 0 || mantissa === 0) return undefined
	if (exponent < 3 || exponent > 32) return undefined
	return { exponent, mantissa }
}

/** Compact bits → target 256-bit (big-endian). `0n` berarti bits tidak valid. */
export const compactToTarget = (bits: number): bigint => {
	const parts = splitCompact(bits)
	if (!parts) return 0n
	const target = BigInt(parts.mantissa) << BigInt(8 * (parts.exponent - 3))
	return target > MAX_TARGET ? 0n : target
}

/** Target 256-bit → compact bits kanonik; `0` bila tidak bisa direpresentasikan. */
export const targetToCompact = (target: bigint): number => {
	if (target <= 0n || target > MAX_TARGET) return 0
	let exponent = Math.ceil(target.toString(16).length / 2)
	if (exponent < 3) return 0
	let mantissa = Number(target >> BigInt(8 * (exponent - 3)))
	if (mantissa > 0x7fffff) {
		mantissa = Math.floor(mantissa / 256)
		exponent++
	}
	if (mantissa === 0 || exponent > 32) return 0
	return exponent * 0x1000000 + mantissa
}

/** Bilangan "bit nol depan" pecahan → compact bits (dipakai retarget & genesis). */
export const difficultyToBits = (fractionalBits: number): number => {
	if (!Number.isFinite(fractionalBits)) return 0
	const bits = clampFractional(fractionalBits)
	const log2Target = 256 - bits
	const exponent = Math.floor(log2Target / 8) + 1
	if (exponent < 3 || exponent > 32) return 0
	const mantissa = Math.round(2 ** (log2Target - 8 * (exponent - 3)))
	if (mantissa <= 0 || mantissa > 0x7fffff) return 0
	return exponent * 0x1000000 + mantissa
}

/** Compact bits → perkiraan bit nol depan (untuk arithmetic retarget). */
export const bitsToDifficulty = (bits: number): number => {
	const parts = splitCompact(bits)
	if (!parts) return MIN_FRACTIONAL_BITS
	return 256 - (8 * (parts.exponent - 3) + Math.log2(parts.mantissa))
}

const clampFractional = (bits: number): number => {
	if (!Number.isFinite(bits)) return MIN_FRACTIONAL_BITS
	const quantized = Math.round(bits / QUANTUM_BITS) * QUANTUM_BITS
	const clean = Object.is(quantized, -0) ? 0 : quantized
	return Math.min(MAX_FRACTIONAL_BITS, Math.max(MIN_FRACTIONAL_BITS, clean))
}

/** Terima compact bits kanonik dalam rentang rantai; selain itu pakai floor. */
export const clampDifficulty = (bits: number): number => {
	const target = compactToTarget(bits)
	if (target === 0n) return difficultyToBits(MIN_FRACTIONAL_BITS)
	const canonical = targetToCompact(target)
	if (canonical === 0) return difficultyToBits(MIN_FRACTIONAL_BITS)
	const difficulty = bitsToDifficulty(canonical)
	if (difficulty < MIN_FRACTIONAL_BITS)
		return difficultyToBits(MIN_FRACTIONAL_BITS)
	if (difficulty > MAX_FRACTIONAL_BITS)
		return difficultyToBits(MAX_FRACTIONAL_BITS)
	return canonical
}

/** Satu-satunya definisi "kerja cukup" — dipakai miner dan node. */
export const meetsDifficulty = (hash: string, bits: number): boolean => {
	if (typeof hash !== 'string' || hash.length !== 64) return false
	const target = compactToTarget(bits)
	if (target === 0n) return false
	return hash.toLowerCase() <= target.toString(16).padStart(64, '0')
}

/**
 * Representasi di JSON-RPC: compact bits selalu hex 8 digit berprefix `0x`.
 * Miner Rust memakai aturan yang sama — `cargo test` menjaga parity-nya.
 */
export const formatBits = (bits: number): string =>
	`0x${bits.toString(16).padStart(8, '0')}`

/** Balikan `formatBits`; `undefined` bila bukan hex uint32 berprefix. */
export const parseBits = (value: unknown): number | undefined => {
	if (typeof value !== 'string' || !/^0x[0-9a-f]{8}$/i.test(value))
		return undefined
	return Number.parseInt(value.slice(2), 16)
}

export const INITIAL_DIFFICULTY_BITS = difficultyToBits(20)
export const MIN_DIFFICULTY_BITS = difficultyToBits(MIN_FRACTIONAL_BITS)
export const MAX_DIFFICULTY_BITS = difficultyToBits(MAX_FRACTIONAL_BITS)

/**
 * Difficulty blok berikutnya, deterministik dari data rantai. Timestamp
 * induk dan blok sama-sama terikat PoW, jadi gap tidak bisa dikarang tanpa
 * mengulang kerja. Hasil selalu compact bits.
 */
export const expectedDifficulty = (
	parentBits: number,
	parentTimestampMs: number,
	blockTimestampMs: number,
	parentHeight: number,
): number => {
	const current = clampFractional(bitsToDifficulty(parentBits))
	if (!Number.isFinite(parentHeight) || parentHeight <= 0)
		return difficultyToBits(current)

	const gap = blockTimestampMs - parentTimestampMs
	if (!Number.isFinite(gap) || gap <= 0) return difficultyToBits(current)

	if (gap <= 2 * TARGET_BLOCK_TIME_MS) {
		const step = Math.log2(TARGET_BLOCK_TIME_MS / gap)
		const clampedStep =
			step > 0 ? Math.min(MAX_RISE_BITS, step) : Math.max(-MAX_FALL_BITS, step)
		return difficultyToBits(clampFractional(current + clampedStep))
	}

	const stallStep = -Math.min(
		Math.ceil(gap / TARGET_BLOCK_TIME_MS) - 1,
		MAX_STALL_FALL_BITS,
	)
	return difficultyToBits(clampFractional(current + stallStep))
}
