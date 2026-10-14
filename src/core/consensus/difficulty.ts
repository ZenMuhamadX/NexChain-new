/**
 * Difficulty Proof-of-Work NexChain — adaptif, target block time 60 detik.
 *
 * Satuan: **bit zerodepan fractional** (bukan jumlah digit heksadesimal),
 * di-quantize ke langkah 0.25. Contoh: difficulty 20 = hash harus diawali
 * tepat 5 digit "0" (setara prefix "00000" pada skema lama); difficulty 20.5
 * = 5 digit "0" + nibble berikutnya < 8.
 *
 * Retarget dihitung per blok oleh NODE ketika menyusun template
 * (`createBlockTemplate` → `calcNextDifficulty`), disimpan di
 * `header.difficulty`, lalu diverifikasi ulang oleh semua pihak lewat
 * `meetsDifficulty` (verify/module/verifyPow).
 *
 * Modul ini SENGAJA murni (tanpa impor DB / model / logging) supaya aman
 * diimpor proses miner eksternal — lihat `client/miner/runMiner.ts`.
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
 * Retarget per blok: `next = current + log2(target / actual)`.
 *
 * - `actualMs` tidak valid (undefined / <= 0, mis. timestamp kembar) →
 *   difficulty tidak berubah;
 * - koreksi dibatasi ±`MAX_RISE_BITS`/`MAX_FALL_BITS` per blok (asimetris,
 *   lihat catatan di konstanta tersebut);
 * - hasil dikunci ke [MIN, MAX] dan kuantisasi 0.25 bit.
 *
 * Nilai disimpan apa adanya di `header.difficulty` — verifikasi rantai memakai
 * nilai tersimpan (meetsDifficulty), BUKAN menghitung ulang retarget, sehingga
 * data rantai lama yang ber-skema lama tetap bisa divalidasi.
 */
export const calcNextDifficulty = (
	currentBits: number,
	actualMs: number | undefined,
): number => {
	const current = clampDifficulty(currentBits)
	if (actualMs === undefined || !Number.isFinite(actualMs) || actualMs <= 0) {
		return current
	}
	const step = Math.log2(TARGET_BLOCK_TIME_MS / actualMs)
	const clampedStep =
		step > 0 ? Math.min(MAX_RISE_BITS, step) : Math.max(-MAX_FALL_BITS, step)
	return clampDifficulty(current + clampedStep)
}

/**
 * Retarget berbasis WAKTU sejak blok terakhir (tip) hingga `nowMs`.
 *
 * `calcNextDifficulty` menerima jarak antar-dua-blok (grandparent → tip).
 * Nilai itu hanya mencerminkan interval DUA blok LAMAU — saat rantai idle
 * (miner tidak menyelesaikan blok / job terus kadaluarsa) ia tetap ~target
 * sehingga difficulty mandek (mis. 27.5) dan tidak pernah turun. Fungsi ini
 * memakai `nowMs - lastBlockTimestampMs`: seberapa lama tip sudah berumur.
 * Idle time ikut terhitung → actualMs tumbuh → difficulty turun ke arah
 * floor, walau blok belum pernah ter-commit.
 *
 * Guard: jarak waktu belum terdefinisi (kemunduran jam / `lastBlockTimestampMs`
 * non-finite) → `clampDifficulty(current)` tanpa koreksi. Selain itu seluruh
 * aturan langkah (asimetris +2/-4), kunci [MIN, MAX] dan kuantisasi 0.25
 * diwarisi dari `calcNextDifficulty`.
 *
 * Nilai hasilnya disimpan di `header.difficulty` dan diverifikasi tersimpan
 * (meetsDifficulty) — BUKAN dihitung ulang oleh pihak lain, jadi perubahan
 * formula ini tidak memutus kompatibilitas data rantai lama.
 */
export const retargetByTime = (
	currentBits: number,
	lastBlockTimestampMs: number,
	nowMs: number = Date.now(),
): number => {
	const current = clampDifficulty(currentBits)
	const actualMs = nowMs - lastBlockTimestampMs
	if (!Number.isFinite(actualMs) || actualMs <= 0) return current
	return calcNextDifficulty(current, actualMs)
}
