/**
 * Marker verifikasi INKREMENTAL (S4 / T03) — "sudah diverifikasi sampai mana".
 *
 * ## Masalah yang dipecahkan
 *
 * Jalur `nex_getWork` memanggil pemeriksaan integritas rantai SEBELUM
 * membangun work. Versi lama (`verifyChainIntegrity`) menelusuri SELURUH
 * rantai dari genesis tiap panggilan: `verifyStruct` (Joi) + `verifyPow` +
 * SHA-256 ulang + merkle + reward + timestamp + difficulty per blok. Miner
 * melakukan polling, jadi biayanya O(N) SETIAP kali — makin panjang rantai,
 * makin lambat, hingga berisiko timeout. Ini pemborosan murni: blok lama
 * sudah pernah diverifikasi dan tidak berubah.
 *
 * ## Model: memoization, BUKAN kepercayaan pada pihak luar
 *
 * Marker adalah memori hasil verifikasi-SENDIRI atas data yang immutable:
 *
 *   1. blok bersifat content-addressed (hash = SHA-256 isinya) — sebuah blok
 *      di height `h` tak bisa berubah tanpa hash-nya berubah;
 *   2. verifikasi deterministik — hasil sama untuk data yang sama;
 *   3. setiap mutasi history (reorg/rollback) memanggil hook R-1 yang
 *      membatalkan marker (`invalidateVerifyMarkerFrom`).
 *
 * Karena itu **hash-keyed** (menyimpan `hash` blok di `height`, bukan tinggi
 * saja): setelah reorg, height yang sama memuat blok BERBEDA, sehingga marker
 * yang hanya keyed-height akan berbohong. Dengan hash, jalur inkremental
 * mendeteksi ketidakcocokan dan jatuh kembali ke verifikasi penuh.
 *
 * ## Batas jujur (trade-off yang diterima)
 *
 * Marker hidup **in-memory** (bukan dipersist), sehingga:
 *   - boot selalu memverifikasi penuh sekali (pemanggilan pertama tanpa
 *     marker), lalu marker memanas selama proses hidup;
 *   - korupsi data di disk SETELAH marker terbentuk (bit-rot / tamper / bug
 *     yang menimpa blok lama) TIDAK tertangkap jalur inkremental selama proses
 *     berjalan. Ini penyimpangan sadar dari "trust nothing" — dimitigasi oleh
 *     verifikasi penuh saat boot dan (opsional, dicadangkan) re-verify berkala.
 *
 * Blok BARU tetap diverifikasi penuh: jalur inkremental memeriksa SELURUH
 * sufiks di atas marker dengan aturan konsensus yang sama; marker hanya
 * melewati prefix yang tak tersentuh. (Bahkan setelah reorg, blok cabang baru
 * sudah divalidasi `connectBlock` saat masuk; verifikasi sufiks adalah lapis
 * kedua.)
 *
 * Modul ini murni (tanpa I/O, tanpa timer) dan aman dipaketkan ke browser.
 */

/** Titik tertinggi yang sudah diverifikasi penuh: blok `hash` di `height`. */
export interface VerifyMarker {
	height: number
	hash: string
}

let marker: VerifyMarker | undefined

/** Salinan marker saat ini, atau `undefined` bila belum ada titik terverifikasi. */
export const getVerifyMarker = (): VerifyMarker | undefined =>
	marker === undefined ? undefined : { ...marker }

/**
 * Majukan marker ke `(height, hash)` setelah blok itu lolos SELURUH
 * pemeriksaan integritas. Dipanggil dari dalam loop verifikasi.
 */
export const setVerifyMarker = (height: number, hash: string): void => {
	marker = { height, hash }
}

/**
 * Hook **R-1 `invalidateFrom(height)`** untuk marker: buang marker bila ia
 * menunjuk height `>= height` (state turunan height itu kini basi setelah tip
 * berubah). Marker dengan height lebih rendah tetap sah — prefix di bawah
 * titik cabang tak tersentuh.
 */
export const invalidateVerifyMarkerFrom = (height: number): void => {
	if (marker !== undefined && marker.height >= height) marker = undefined
}

/** Buang marker sepenuhnya (boot/uji, atau sebelum verifikasi penuh). */
export const resetVerifyMarker = (): void => {
	marker = undefined
}
