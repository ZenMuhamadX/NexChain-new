/**
 * Difficulty Proof-of-Work NexChain — adaptif, target block time 60 detik.
 *
 * Satuan: **bit zerodepan fractional** (bukan jumlah digit heksadesimal),
 * di-quantize ke langkah 0.25. Contoh: difficulty 20 = hash harus diawali
 * tepat 5 digit "0" (setara prefix "00000" pada skema lama); difficulty 20.5
 * = 5 digit "0" + nibble berikutnya < 8.
 *
 * `header.difficulty` IKUT preimage PoW (lihat `prepareBlockForHashing`), dan
 * angka yang diperbolehkan dihitung ULANG oleh setiap validator lewat
 * `expectedDifficulty` — BUKAN dipercaya dari header. Semua node memakai
 * fungsi murni yang sama sehingga hasilnya identik; determinisme inilah
 * mekanisme "sinkronisasi"-nya (tidak ada nilai difficulty yang dikirim).
 *
 * `meetsDifficulty` tetap satu-satunya definisi "kerja cukup" (dipakai miner
 * & node).
 *
 * Modul ini SENGAJA murni (tanpa impor DB / model / logging) supaya aman
 * diimpor proses miner eksternal — lihat `apps/miner/`.
 */

/** Target jarak antar blok (ms). Inilah yang dikejar retarget. */
export const TARGET_BLOCK_TIME_MS = 60_000

/** Difficulty awal rantai (== skema lama prefix 5 digit heksadesimal). */
export const INITIAL_DIFFICULTY_BITS = 20

/** Batas bawah/atas difficulty (mencegah rantai berhenti atau tak terjangkau). */
export const MIN_DIFFICULTY_BITS = 8
export const MAX_DIFFICULTY_BITS = 48

/**
 * Batas koreksi retarget PER BLOK — asimetris, hasil kalibrasi lapangan:
 *
 * - `MAX_RISE_BITS` 2 (naik): koreksi naik yang agresif membuat cascade blok
 *   1-detik melompat MELEWATI titik seimbang (mis. 20 → 24 bit untuk hashrate
 *   ~120 kH/s) sehingga blok berikutnya memakan menit. Dengan langkah maks
 *   +2, pendekatan ke titik seimbang monoton — ladder waktu blok menyempit ke
 *   sekitar target tanpa overshoot besar.
 * - `MAX_FALL_BITS` 4 (turun): blok yang sangat lambat / idle time panjang
 *   harus segera kembali ke sekitar target; jatuh maks 4 bit per blok
 *   memulihkan equilibrium dalam 1–2 blok (turun 14 bit sekaligus setelah
 *   menganggur semalam tetap dicegah).
 * - Kalibrasi ini dilakukan saat target masih 30 detik; ketika target
 *   digeser ke 60 detik (P2) nilai ±2/4 bit DIPERTAHANKAN — langkah
 *   per-blok yang sama kini bergerak dua kali lebih lambat dalam satuan
 *   "kejutan waktu", yang justru menurunkan overshoot tanpa mengubah
 *   sifat asimetris (naik hati-hati, turun cepat).
 */
export const MAX_RISE_BITS = 2
export const MAX_FALL_BITS = 4

/**
 * Batas penurunan **borongan** saat rantai menganggur lama (`gap > 2×TARGET`).
 * Berbeda dari `MAX_FALL_BITS` (koreksi halus per blok), ini langkah
 * pemulihan: blok jujur setelah idle panjang langsung turun banyak bit agar
 * rantai segera kembali mendekati target. Dipakai HANYA oleh
 * `expectedDifficulty`; nilainya boleh disetel 8–12 (kalibrasi devnet).
 */
export const MAX_STALL_FALL_BITS = 8

/** Langkah kuantisasi difficulty (bit) supaya nilai deterministik & ringkas. */
const QUANTUM_BITS = 0.25

/** Batasi difficulty ke [MIN, MAX] lalu kuantisasi ke kelipatan 0.25 bit. */
export const clampDifficulty = (bits: number): number => {
	if (!Number.isFinite(bits)) return MIN_DIFFICULTY_BITS
	const quantized = Math.round(bits / QUANTUM_BITS) * QUANTUM_BITS
	// Hindari -0 dan bulatkan representasi float (mis. 20.25 aman, tapi
	// hasil operasi float bisa menghasilkan 20.249999999999996).
	const clean = Object.is(quantized, -0) ? 0 : quantized
	return Math.min(MAX_DIFFICULTY_BITS, Math.max(MIN_DIFFICULTY_BITS, clean))
}

/**
 * Apakah `hash` (hex SHA-256, 64 digit) memenuhi difficulty `bits`?
 *
 * Cara kerja (ekivalen dengan `hash < 2^(256 - bits)` tapi cepat, string-only):
 *   - `floor(bits/4)` digit heksadesimal pertama wajib "0";
 *   - sisa `bits mod 4` bit ditentukan oleh nibble berikutnya:
 *     nibble < 2^(4 - sisa).
 *
 * Fungsi ini adalah SATU-SATUNYA definisi "kerja cukup" — dipakai identik
 * oleh miner (loop PoW) dan node (verifikasi submit + verifyPow), sehingga
 * kriteria produksi dan kriteria validasi tidak bisa lagi berbeda.
 */
export const meetsDifficulty = (hash: string, bits: number): boolean => {
	if (typeof hash !== 'string' || hash.length !== 64) return false
	if (!Number.isFinite(bits)) return false
	if (bits <= 0) return true // difficulty 0 = tanpa syarat

	const zeroDigits = Math.floor(bits / 4)
	const remainder = bits - zeroDigits * 4 // di [0, 4)

	for (let i = 0; i < zeroDigits; i++) {
		if (hash[i] !== '0') return false
	}
	if (remainder > 0) {
		const nibble = Number.parseInt(hash[zeroDigits], 16)
		// parseInt melempar NaN untuk digit non-heksadesimal → tolak.
		if (!Number.isFinite(nibble)) return false
		if (nibble >= 2 ** (4 - remainder)) return false
	}
	return true
}

/**
 * Difficulty yang DIPERBOLEHKAN untuk blok `height = parentHeight + 1`,
 * dihitung HANYA dari data rantai (deterministik) — menggantikan retarget
 * berbasis jam dinding node (`now - tip.timestamp`) yang membuat tiap node
 * bisa menghitung angka berbeda untuk blok yang sama.
 *
 * `gap = blockTimestampMs - parentTimestampMs` — KEDUA timestamp terikat PoW
 * (keduanya ikut preimage), jadi penambang tidak bisa mengarang jarak tanpa
 * mengulang kerja:
 *   - `parentHeight <= 0` (blok pertama di atas genesis) atau `gap <= 0`
 *     (timestamp kembar/mundur) → difficulty tidak berubah;
 *   - `gap <= 2×TARGET` → koreksi halus `log2(TARGET/gap)`, dijepit
 *     `[-MAX_FALL_BITS, +MAX_RISE_BITS]`;
 *   - `gap > 2×TARGET` → pemulihan borongan `-min(ceil(gap/TARGET) - 1,
 *     MAX_STALL_FALL_BITS)` (idle panjang turun agresif, bukan hanya 4 bit).
 *
 * Hasil selalu lewat `clampDifficulty` (kuantisasi 0.25 bit, kunci
 * [MIN, MAX]). Karena murni, `createBlockTemplate` dan semua validator
 * (`commitBlock`, `connectBlock`, `verifyChainIntegrity`) memakai fungsi yang
 * SAMA → angka identik di seluruh node.
 *
 * @param parentBits        difficulty blok induk (`parent.difficulty`)
 * @param parentTimestampMs timestamp blok induk (epoch ms)
 * @param blockTimestampMs  timestamp blok yang dinilai (epoch ms)
 * @param parentHeight      tinggi blok induk
 */
export const expectedDifficulty = (
	parentBits: number,
	parentTimestampMs: number,
	blockTimestampMs: number,
	parentHeight: number,
): number => {
	const current = clampDifficulty(parentBits)
	if (!Number.isFinite(parentHeight) || parentHeight <= 0) return current

	const gap = blockTimestampMs - parentTimestampMs
	if (!Number.isFinite(gap) || gap <= 0) return current

	if (gap <= 2 * TARGET_BLOCK_TIME_MS) {
		const step = Math.log2(TARGET_BLOCK_TIME_MS / gap)
		const clampedStep =
			step > 0 ? Math.min(MAX_RISE_BITS, step) : Math.max(-MAX_FALL_BITS, step)
		return clampDifficulty(current + clampedStep)
	}

	const stallStep = -Math.min(
		Math.ceil(gap / TARGET_BLOCK_TIME_MS) - 1,
		MAX_STALL_FALL_BITS,
	)
	return clampDifficulty(current + stallStep)
}
