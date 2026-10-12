import { toNexu } from 'src/core/token/toNexu'

/**
 * Gas price baku per blok, dalam nexu — **satu** sumber kebenaran untuk
 * template (`createBlockTemplate`) dan verifikasi konsensus
 * (`verify/module/verifyReward`).
 *
 * Nilainya persis literal yang dulu inline di template:
 * `toNexu(0.00025)` → `25_000` nexu tepat (konversi `parseNxc` murni
 * string, tanpa IEEE-754 — lihat `toNexu`).
 *
 * Jangan diubah tanpa perubahan konsensus yang disengaja: `verifyReward`
 * membandingkan `metadata.gasPrice` blok terhadap konstanta ini dengan `===`,
 * sehingga template dan verifier MUSTAHIL berbeda selama keduanya mengimpor
 * nilai yang sama.
 */
export const GAS_PRICE_NEXU = toNexu(0.00025)

export const calculateTotalBlockReward = (
	reward: number,
	gasPrice: number,
	totalTxFees: number,
) => {
	return reward + gasPrice + totalTxFees
}
