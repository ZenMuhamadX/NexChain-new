import { toNexu } from 'src/core/token/toNexu'

/**
 * Jadwal halving hadiah blok — **pengganti** skema linear-per-20-blok lama
 * (audit P2).
 *
 * ====================================================================
 * MENGAPA DIGANTI
 * ====================================================================
 * Skema lama (50 NXC turun 0.00099998 NXC tiap 20 blok, lantai 0.001 NXC)
 * TIDAK PERNAH mencapai nol: rantai terus mencetak 0.001 NXC + gasPrice
 * selamanya, sehingga total suplai hanya dibatasi guard plafon per-blok —
 * bukan oleh jadwal itu sendiri. Jadwal halving membuat Σ total TERBATAS
 * dan terbukti closed-form di bawah plafon 50 juta NXC.
 *
 * ====================================================================
 * ATURAN (gaya Bitcoin, disederhanakan)
 * ====================================================================
 *   R0   = 12.5 NXC = 1_250_000_000 nexu (hadiah blok pertama)
 *   H    = 2_000_000 blok per epoch
 *   epoch(h) = floor((h - 1) / H)          untuk h >= 1
 *   reward(h) = floor(R0 / 2^epoch) dalam nexu; bila hasil < 1 nexu → 0
 *
 * Boundary WAJIB (diuji `check:consensus`):
 *   h = 1 … 2_000_000     → 1_250_000_000 (12.5 NXC)
 *   h = 2_000_001 … 4_000_000 → 625_000_000 (6.25 NXC)
 *   halving PERTAMA tepat di blok 2_000_001.
 *
 * Lantai linear lama (minReward 0.001 NXC) DIHAPUS: seperti Bitcoin
 * membuang subsidi sub-satoshi, reward di bawah 1 nexu menjadi 0 — blok
 * tetap sah dengan hadiah hanya fee (totalReward = totalTransactionFees).
 *
 * ====================================================================
 * BUKTI Σ ≤ 50 JUTA NXC (closed-form, bukan simulasi)
 * ====================================================================
 * Jumlah seluruh epoch: reward epoch e = ⌊R0 / 2^e⌋ (0 untuk e cukup
 * besar), tiap epoch H blok:
 *
 *   Σ = H · Σ_e ⌊R0/2^e⌋ = H · (2·R0 − popcount(R0))
 *
 * (identitas bilangan bulat: Σ_{e≥0} ⌊n/2^e⌋ = 2n − popcount(n)).
 * R0 = 1_250_000_000 = 0x4A817C80 → popcount = 11, sehingga
 *
 *   Σ = 2_000_000 · (2_500_000_000 − 11) = 4_999_999_978_000_000 nexu
 *     = 49_999_999.78 NXC  ≤  50_000_000 NXC  ✓
 *
 * Margin 220 NXC = 5e15 − Σ berasal dari penyisihan pecahan biner saat
 * pembagian per-epoch (popcount). `totalIssued` kini menjumlahkan
 * `blockReward` SAJA (fee bukan pencetakan baru — lihat `setState.ts`),
 * jadi Σ ini adalah batas suplai riil yang TIDAK bisa dilewati fee.
 *
 * Nilai awal & panjang epoch adalah KONSENSUS: `blockReward` ikut preimage
 * PoW (`prepareBlockForHashing`) dan `verifyBlockReward` membandingkan
 * ulang `cutBlockReward(height)` — mengubah konstanta di sini mengubah
 * seluruh rantai (RESET RANTAI DIPERLUKAN).
 */

/** Hadiah blok epoch-0 (nexu). 12.5 NXC — bilangan bulat eksak. */
export const INITIAL_REWARD_NEXU = toNexu(12.5)

/** Jumlah blok per epoch halving. */
export const HALVING_INTERVAL = 2_000_000

/**
 * Hadiah blok (nexu) untuk `height` tertentu — SATU-SATUNYA definisi
 * jadwal, dipakai identik oleh template (`createBlockTemplate`) dan
 * verifikasi (`verifyReward`).
 *
 * - `height < 1` (mis. genesis) → 0: genesis punya reward konstantanya
 *   sendiri (`GENESIS_REWARD_NEX`) dan dieksplisitkan dari aturan blok
 *   biasa oleh `verifyBlockReward`;
 * - perhitungan memakai `Math.floor` bilangan bulat — `INITIAL_REWARD_NEXU`
 *   dan `HALVING_INTERVAL` keduanya bilangan bulat aman, dan hasil
 *   pembagian/biner tetap bilangan bulat aman;
 * - `2 ** epoch` untuk epoch raksasa menjadi `Infinity` → hasil 0 dengan
 *   sendirinya (tanpa overflow tersembunyi).
 */
export const cutBlockReward = (currentHeight: number): number => {
	if (currentHeight < 1) return 0
	const epoch = Math.floor((currentHeight - 1) / HALVING_INTERVAL)
	const reward = Math.floor(INITIAL_REWARD_NEXU / 2 ** epoch)
	// Sub-satoshi-style: di bawah 1 nexu → 0 (jangan pernah mencetak
	// pecahan yang tidak bisa direpresentasikan).
	return reward < 1 ? 0 : reward
}
