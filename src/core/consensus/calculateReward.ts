/**
 * Total hadiah blok yang dikreditkan ke coinbase (nexu).
 *
 * ====================================================================
 * PENGHAPUSAN gasPrice (audit P2)
 * ====================================================================
 * Sebelumnya fungsi ini `reward + gasPrice + totalTxFees` dengan
 * `GAS_PRICE_NEXU = 25_000` nexu per blok — "nxc dari udara": nilai itu
 * tidak berasal dari fee pengguna, dicetak protokol begitu saja, dan
 * harus dijaga kemunculannya di tiga tempat (template, verifier,
 * metadata). Kini hanya ada SATU sumber pendapatan miner yang sah:
 * hadiah blok (`cutBlockReward`) + fee transaksi (`calculateTotalFees`).
 *
 * Fee tetap mengalir penuh ke miner — model fee-transfer-nya tidak
 * berubah: pengirim didebit `amount + fee`, penerima `+amount`, miner
 * `+fee` (lihat `processSender`).
 *
 * Dipakai identik oleh `createBlockTemplate` (menyusun) dan
 * `verifyReward` (menghitung ulang) — perbandingan `===` ketat tanpa
 * epsilon, karena kedua sisi menjalankan operasi yang sama.
 */
export const calculateTotalBlockReward = (
	reward: number,
	totalTxFees: number,
) => {
	return reward + totalTxFees
}
