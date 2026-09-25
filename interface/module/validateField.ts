import { logError } from './writeLog'

/**
 * Helper validasi transaksi.
 *
 * SEMANTIKAS (STAGE 1 FIX):
 * Argumen pertama adalah **kondisi yang harus BENAR** (`isValid`), bukan
 * "error terjadi?". Fungsi mengembalikan:
 *
 *   - `true`  -> aturan terpenuhi, lanjut ke validasi berikutnya
 *   - `false` -> aturan dilanggar, sudah dicatat, pemanggil HARUS berhenti
 *
 * SEBELUMNYA (BUG): argumen pertama bermakna `writeError` - "kalau kondisi
 * ini benar, berarti error". Akibatnya setiap pemanggil harus menulis kondisi
 * secara terbalik (`amount <= 0`, `!isValidAddress(...)`, `sender === receiver`,
 * `fee > amount`), sehingga aturan yang terbalik justru lolos dan transaksi
 * valid justru ditolak. Nama `validateField` juga tidak memberi hint apakah
 * argumennya kondisi valid atau kondisi error.
 *
 * SEKARANG: nama `validateRule` + argumen `isValid` membuat kebalikannya
 * mustahil dibaca salah — setiap call site menyatakan secara literal apa yang
 * harus BENAR.
 *
 * @param isValid kondisi yang harus bernilai `true` agar validasi lolos.
 * @param context nama modul/konteks untuk log.
 * @param hint pesan yang dicatat saat aturan dilanggar.
 * @returns `true` bila valid, `false` bila tidak valid.
 */
export const validateRule = (
	isValid: boolean,
	context: string,
	hint: string,
): boolean => {
	if (isValid) {
		return true
	}
	logError(context, hint, hint)
	return false
}
