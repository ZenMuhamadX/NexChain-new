/**
 * Konstanta satuan & suplai NXC.
 *
 * ========================================================================
 * PENTING — kontrak lintas-package
 * ========================================================================
 * Seluruh node, client, explorer, dan wallet WAJIB memakai
 * `NEXU_PER_NXC` yang sama. Nilai ini adalah definisi satuan jaringan:
 *
 *     1 NXC  =  NEXU_PER_NXC  nexu (satuan terkecil on-chain)
 *
 * Mengubah konstanta ini = mengubah SELURUH nilai on-chain (reward, saldo,
 * fee) sekaligus preimage PoW (`prepareBlockForHashing` memuat
 * `blockReward`), sehingga genesis hash berubah dan rantai harus di-reset.
 * Perubahan semacam itu adalah hard fork — lakukan hanya sebelum jaringan
 * punya node eksternal.
 *
 * Desimal 8 dipilih (gaya satoshi/Bitcoin) supaya aritmetika `number`
 * tetap eksak: semua bilangan bulat di bawah `2^53` direpresentasikan
 * tepat, tanpa pembulatan.
 */

/** Jumlah desimal NXC. 8 → 1 NXC = 100_000_000 nexu. */
export const NXC_DECIMALS = 8

/** Satuan terkecil on-chain. 1 NXC = 100_000_000 nexu. */
export const NEXU_PER_NXC = 100_000_000

/**
 * Plafon total suplai, dalam NXC.
 *
 * Dipilih 50 juta supaya `MAX_SUPPLY_NEXU` tetap jauh di bawah
 * `Number.MAX_SAFE_INTEGER` (9.007_199_254_740_991):
 *
 *     50_000_000 × 100_000_000 = 5_000_000_000_000_000   (5 × 10^15)
 *     headroom = 9.007 × 10^15 / 5 × 10^15 = 1.80×
 *
 * Karena plafon ini hard invariant yang dijaga di SETIAP penulisan state
 * (bukan properti emergent seperti jadwal halving Bitcoin), headroom 1.8×
 * sudah cukup: tidak ada nilai — termasuk nilai perantara `amount + fee`
 * dan `Σ satu blok` — yang bisa melampaui plafon ini.
 *
 * JANGAN menaikkan angka ini di atas 90_071_992 NXC: di atas itu
 * `MAX_SUPPLY_NEXU` melewati `2^53` dan `number` kehilangan presisi
 * SECARA DIAM-DIAM (tidak error, hanya salah). `assertUnitConstants()`
 * memverifikasi ini saat boot supaya perubahan semacam itu gagal keras.
 */
export const MAX_SUPPLY_NXC = 50_000_000

/**
 * Plafon total suplai, dalam nexu.
 *
 * Kedua faktornya bilangan bulat aman dan hasilnya juga bilangan bulat
 * aman — diverifikasi oleh `assertUnitConstants()`.
 */
export const MAX_SUPPLY_NEXU: number = MAX_SUPPLY_NXC * NEXU_PER_NXC

/**
 * Bilangan bulat aman terbesar yang bisa diekspresikan dalam NXC pada
 * satuan ini (90_071_992 NXC). Sengaja di-export supaya test bisa
 * memastikan `MAX_SUPPLY_NXC` masih berada di bawahnya.
 */
export const MAX_SAFE_NXC: number = Math.floor(
	Number.MAX_SAFE_INTEGER / NEXU_PER_NXC,
)

/**
 * Verifikasi konstanta satuan. Dipanggil saat boot node dan oleh
 * `bun run check:amount`.
 *
 * Gagal = konstanta sudah diubah menjadi nilai yang TIDAK aman untuk
 * `number` (mis. menaikkan plafon di atas 90 juta NXC, atau mengubah
 * desimal tanpa menyesuaikan plafon). Kondisi ini harus menghentikan
 * node, bukan dibiarkan menghasilkan saldo yang salah secara diam-diam.
 *
 * @throws Error bila konstanta tidak konsisten atau tidak aman.
 */
export const assertUnitConstants = (): void => {
	const fail = (reason: string): never => {
		throw new Error(
			`Konstanta satuan NXC tidak valid: ${reason}. ` +
				`Periksa nexchain/nexucoin/constants.ts ` +
				`(NEXU_PER_NXC=${NEXU_PER_NXC}, MAX_SUPPLY_NXC=${MAX_SUPPLY_NXC}).`,
		)
	}

	if (!Number.isInteger(NEXU_PER_NXC) || NEXU_PER_NXC <= 0) {
		fail(`NEXU_PER_NXC=${NEXU_PER_NXC} harus bilangan bulat positif`)
	}
	if (NEXU_PER_NXC !== 10 ** NXC_DECIMALS) {
		fail(
			`NEXU_PER_NXC=${NEXU_PER_NXC} tidak sama dengan 10^${NXC_DECIMALS}`,
		)
	}
	if (!Number.isInteger(MAX_SUPPLY_NXC) || MAX_SUPPLY_NXC <= 0) {
		fail(`MAX_SUPPLY_NXC=${MAX_SUPPLY_NXC} harus bilangan bulat positif`)
	}
	if (!Number.isSafeInteger(MAX_SUPPLY_NEXU)) {
		fail(
			`MAX_SUPPLY_NEXU=${MAX_SUPPLY_NEXU} bukan bilangan bulat aman ` +
				`(maks ${Number.MAX_SAFE_INTEGER}) — plafon terlalu besar untuk "number"`,
		)
	}
	if (MAX_SUPPLY_NEXU > Number.MAX_SAFE_INTEGER) {
		fail(
			`MAX_SUPPLY_NEXU=${MAX_SUPPLY_NEXU} melewati ` +
				`Number.MAX_SAFE_INTEGER=${Number.MAX_SAFE_INTEGER}`,
		)
	}
	if (MAX_SUPPLY_NEXU !== MAX_SUPPLY_NXC * NEXU_PER_NXC) {
		fail(
			`MAX_SUPPLY_NEXU=${MAX_SUPPLY_NEXU} bukan hasil ` +
				`MAX_SUPPLY_NXC × NEXU_PER_NXC`,
		)
	}
	// Plafon harus benar-benar berada di bawah batas aman, dengan margin
	// minimal 1× — kalau tidak, setiap saldo mendekati plafon sudah tidak
	// bisa direpresentasikan.
	if (MAX_SUPPLY_NXC > MAX_SAFE_NXC) {
		fail(
			`MAX_SUPPLY_NXC=${MAX_SUPPLY_NXC} melewati kapasitas aman ` +
				`${MAX_SAFE_NXC} NXC`,
		)
	}
}
