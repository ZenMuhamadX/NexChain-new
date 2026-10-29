/**
 * Mutex commit global — SATU commit blok pada satu waktu, di seluruh proses.
 *
 * ## Mengapa perlu
 *
 * Tiga jalur berbeda memanggil `commitBlock` dengan antrean MASING-MASING:
 * `workQueue` (mining lokal), `connectQueue` (blok P2P), dan replay reorg.
 * Ketiganya bisa saling menyela di titik `await`. Akibatnya `beginWriteBuffer`
 * kedua akan menimpa buffer pertama, lalu buffer itu dibuang saat commit
 * pertama selesai — tulisan commit kedua hilang tanpa error.
 *
 * Antrean per-jalur tidak cukup karena yang harus diserialkan adalah **commit**,
 * bukan kedatangan blok. Mutex ini milik commit itu sendiri.
 *
 * Reorg memanggil `commitBlock` secara berurutan (bukan bersarang), jadi tidak
 * ada risiko deadlock: setiap panggilan mengambil lalu melepas kunci.
 */
let tail: Promise<unknown> = Promise.resolve()

/** Jalankan `op` setelah semua commit sebelumnya selesai (FIFO). */
export const withCommitLock = <T>(op: () => Promise<T>): Promise<T> => {
	const running = tail.then(op)
	tail = running.catch(() => undefined)
	return running
}
