/**
 * Gerbang penekan siaran (broadcast gate).
 *
 * Masalah yang dipecahkan: blok/transaksi yang MASUK dari peer diproses lewat
 * fungsi core yang SAMA dengan blok/transaksi LOKAL (`connectBlock` →
 * `commitBlock`, `addTxToMempool`). Padahal bus peristiwa core
 * (`src/core/events/nodeEvents.ts`) menerbitkan peristiwa untuk KEDUANYA.
 *
 * Tanpa gerbang ini, tx yang baru diterima dari peer A akan segera
 * disiarkan kembali — termasuk KE peer A — sehingga dua node bisa saling
 * memantulkan pengumuman yang sama tanpa henti (badai gossip).
 *
 * Solusinya: saat sync manager memproses pesan masuk, ia membungkus
 * mutasinya dengan `runSuppressed(...)`, lalu menyiarkan sendiri dengan
 * `except` si pengirim. Langganan bus di `node.ts` melewatkan siaran selama
 * gerbang tertutup.
 *
 * Modul ini murni dan sinkron; penghitung bersarang (depth) agar pembungkusan
 * bertingkat tetap benar.
 */
let depth = 0

/** Apakah siaran sedang ditekan. */
export const isBroadcastSuppressed = (): boolean => depth > 0

/**
 * Jalankan `fn` dengan siaran ditekan. Selalu menurunkan penghitung, bahkan
 * bila `fn` melempar.
 */
export const runSuppressed = async <T>(fn: () => Promise<T>): Promise<T> => {
	depth++
	try {
		return await fn()
	} finally {
		depth--
	}
}
