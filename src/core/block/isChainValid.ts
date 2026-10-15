import { verifyChainIncremental } from 'src/core/consensus/verify/verifyIntegrity'

/**
 * Apakah rantai lokal layak dibangun di atasnya (gerbang `nex_getWork`).
 *
 * Sejak S4 jalur ini **inkremental**: verifikasi hanya blok yang belum
 * diverifikasi sejak pemeriksaan terakhir, memakai marker hash-keyed
 * (`consensus/verify/verifyMarker.ts`). Verifikasi penuh dari genesis hanya
 * berjalan sekali — pada pemanggilan pertama (belum ada marker) atau setelah
 * marker dibatalkan (reorg). Aturan konsensus yang diperiksa tetap sama
 * (struktur, PoW, hash, merkle, hadiah, timestamp, difficulty).
 */
export const isChainsValid = async (): Promise<boolean> =>
	verifyChainIncremental()
