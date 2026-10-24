/**
 * Perbandingan laju-fee (fee per byte) yang EKSAK.
 *
 * Dipakai DUA tempat yang sebelumnya sama-sama mengalikan silang dengan
 * `number` mentah (`feeBaru·ukuranLama` vs `feeLama·ukuranBaru`):
 *
 *   - `MemPool.addTransaction` → `replacesFeeRate` (aturan RBF: pengganti
 *     wajib ber-laju lebih tinggi);
 *   - `prioritizeByFeeRate` (urutan pengambilan tx ke template blok).
 *
 * MENGAPA perlu: `fee` boleh sampai `MAX_SUPPLY_NEXU` (5×10^15) dan ukuran
 * wire puluhan byte, sehingga produknya bisa melewati `2^53` (≈9×10^15).
 * Di atas batas itu `number` kehilangan presisi: dua laju yang BERBEDA bisa
 * terbanding sama, sehingga pengganti yang sah ditolak (atau sebaliknya).
 *
 * Jalur cepat tetap `number` — untuk seluruh fee yang wajar produknya jauh di
 * bawah `2^53`, dan ini jalur yang dieksekusi puluhan ribu kali saat menyusun
 * template. BigInt hanya dipakai ketika produknya benar-benar keluar dari
 * rentang aman, jadi biayanya nol pada kasus normal.
 *
 * @returns -1 bila laju A < B, 1 bila A > B, 0 bila sama.
 */
const sign = (a: number | bigint, b: number | bigint): number =>
	a === b ? 0 : a > b ? 1 : -1

export const compareFeeRate = (
	aFee: number,
	aSize: number,
	bFee: number,
	bSize: number,
): number => {
	const a = aFee * bSize
	const b = bFee * aSize
	if (Number.isSafeInteger(a) && Number.isSafeInteger(b)) return sign(a, b)

	// Produk di luar rentang aman: `number` sudah membulatkan. Hitung ulang
	// dengan BigInt — hanya bila keempat masukannya bilangan bulat aman, supaya
	// nilai non-kanonik (mis. dari pemanggil lama) tidak melempar di sini.
	if (
		Number.isSafeInteger(aFee) &&
		Number.isSafeInteger(aSize) &&
		Number.isSafeInteger(bFee) &&
		Number.isSafeInteger(bSize)
	) {
		return sign(BigInt(aFee) * BigInt(bSize), BigInt(bFee) * BigInt(aSize))
	}
	// Masukan sendiri tidak aman: tak ada representasi eksak yang lebih baik
	// daripada hasil `number` di atas — kembalikan apa adanya (fail-soft).
	return sign(a, b)
}
