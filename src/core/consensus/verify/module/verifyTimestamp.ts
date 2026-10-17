import { Block } from 'src/core/block/blockModel'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { TARGET_BLOCK_TIME_MS } from 'src/core/consensus/difficulty'

/** Jendela median-time-past (Bitcoin: 11 blok sebelumnya). */
export const MTP_WINDOW = 11

/**
 * Batas timestamp ke depan: **2× target blok (~2 menit)** dari `nowMs`.
 *
 * Penyimpangan sadar dari Bitcoin (2 jam): retarget kita berjalan **per blok
 * (windowless)**, sedangkan Bitcoin berjendela 2016 blok. Dengan retarget per
 * blok, penambang bisa "mengarang jarak" waktu untuk memaksa difficulty turun;
 * memperketat batas masa depan ke 2 menit membatasi gap palsu maksimum ~1 bit
 * (tidak signifikan), SEMENTARA stall asli tetap terdeteksi — blok jujur
 * setelah idle panjang punya `blockTs - parentTs` = lama diam NYATA (induk
 * memang tua) dan validator menghitung gap literal yang sama.
 */
export const MAX_FUTURE_DRIFT_MS = 2 * TARGET_BLOCK_TIME_MS

/**
 * Median-time-past sejumlah timestamp — aturan yang SAMA untuk verifikasi
 * dan penyusunan template.
 *
 * Jendela diurutkan naik, median memakai `Math.floor(len / 2)` (indeks
 * tengah; untuk 11 elemen = elemen ke-6 setelah urut). Daftar kosong → `0`
 * (dipakai template: timestamp apa pun > 0 lolos).
 *
 * @param timestamps timestamp blok-blok sebelumnya (tak wajib terurut)
 */
export const medianTimePast = (timestamps: number[]): number => {
	if (timestamps.length === 0) return 0
	const sorted = [...timestamps].sort((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Aturan konsensus timestamp: **MTP-11 + batas masa depan**.
 *
 *   1. `timestamp` WAJIB **lebih besar** ketat dari median 11 blok
 *      sebelumnya (median-time-past) — mencegah pemalsuan urutan waktu
 *      oleh penambang yang bisa memilih waktu; aturan yang sama dipakai
 *      `createBlockTemplate`, sehingga blok yang disusun node tervalidasi
 *      oleh konstruksi (mining cepat di dev tidak menolak dirinya sendiri);
 *   2. `timestamp` tidak boleh lebih dari `MAX_FUTURE_DRIFT_MS` (2× target
 *      blok) ke depan dari `nowMs` — membatasi penambang yang menyetel jam
 *      ke masa depan untuk memanipulasi retarget difficulty.
 *
 * Daftar `previousTimestamps` KOSONG = hanya cek masa depan yang berjalan —
 * genesis-safe (height 0 tidak punya parent).
 *
 * @param timestamp         timestamp blok yang diperiksa (epoch ms)
 * @param previousTimestamps timestamp blok-blok sebelumnya (kronologis)
 * @param nowMs             waktu sekarang (dipinject agar bisa diuji murni)
 * @returns `null` bila valid, atau alasan singkat bila tidak.
 */
export const checkBlockTimestamp = (
	timestamp: number,
	previousTimestamps: number[],
	nowMs: number,
): string | null => {
	const window = previousTimestamps.slice(-MTP_WINDOW)
	if (window.length > 0) {
		const mtp = medianTimePast(window)
		if (timestamp <= mtp) {
			return `timestamp ${timestamp} <= median-time-past ${mtp} (harus lebih besar)`
		}
	}

	if (timestamp > nowMs + MAX_FUTURE_DRIFT_MS) {
		return `timestamp ${timestamp} melebihi batas masa depan ${nowMs + MAX_FUTURE_DRIFT_MS}`
	}

	return null
}

/**
 * Ambil timestamp `height - 1` … `height - 11` (maksimal 11 blok) dari DB,
 * dalam urutan kronologis. Height yang tidak ada di DB dilewati.
 *
 * Pembacaan DB — sengaja TERPISAH dari `checkBlockTimestamp` yang murni,
 * sehingga aturan bisa diuji tanpa LevelDB.
 */
export const getPreviousTimestamps = async (
	height: number,
): Promise<number[]> => {
	const timestamps: number[] = []
	for (let h = Math.max(0, height - MTP_WINDOW); h < height; h++) {
		const block = (await getBlockByHeight(h)) as Block | undefined
		if (!block) continue
		timestamps.push(block.block.header.timestamp)
	}
	return timestamps
}
