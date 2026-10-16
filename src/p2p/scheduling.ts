/**
 * Penjadwalan loop layanan P2P (pacing).
 *
 * Node adalah SATU proses: RPC (`nex_getWork`, explorer, wallet) dan P2P
 * berbagi event loop yang sama. Loop layanan yang panjang — menjawab
 * `getblocks`/`getdata`/`inv` sampai `MAX_INV_BATCH` item — hanya `await`
 * penyimpanan LevelDB, yang beresolusi lewat MICROTASK. Microtask dikuras
 * habis sebelum event loop memeriksa socket/timer, sehingga satu permintaan
 * peer bisa menahan RPC/UI.
 *
 * `yieldToLoop()` memaksa batas MAKROTASK: giliran diserahkan ke task lain di
 * belakang antrean (mis. permintaan RPC) sebelum melanjutkan. Pacing =
 * proses item per chunk lalu yield di antaranya (gaya send-queue/token-bucket
 * Bitcoin, versi sederhana).
 */

/** Serahkan giliran ke event loop pada batas makrotask. */
export type YieldFn = () => Promise<void>

export const yieldToLoop: YieldFn = () =>
	new Promise<void>((resolve) => {
		// `setImmediate` lebih dulu; fallback `setTimeout(0)` untuk runtime
		// tanpa setImmediate (keduanya tetap batas makrotask).
		if (typeof setImmediate === 'function') setImmediate(resolve)
		else setTimeout(resolve, 0)
	})

/**
 * Jalankan `visit` untuk tiap item, sisipkan `yieldFn()` di antara setiap
 * `chunkSize` item (TIDAK setelah item terakhir). Urutan item dipertahankan.
 *
 * `visit` mengembalikan `false` untuk berhenti lebih awal (sisa item dilewati,
 * tanpa yield tambahan), atau `true` untuk melanjutkan. Kontraknya selalu
 * `boolean` supaya pemanggil tak pernah "lupa" mengembalikan nilai. `chunkSize`
 * < 1 atau bukan angka dijepit ke 1 agar tak ada loop yang tak pernah
 * menyerahkan giliran.
 */
export const forEachChunked = async <T>(
	items: readonly T[],
	chunkSize: number,
	visit: (item: T, index: number) => boolean | Promise<boolean>,
	yieldFn: YieldFn = yieldToLoop,
): Promise<void> => {
	const size = Number.isFinite(chunkSize)
		? Math.max(1, Math.trunc(chunkSize))
		: 1
	for (let i = 0; i < items.length; i++) {
		const keepGoing = await visit(items[i], i)
		if (!keepGoing) return
		const endOfChunk = (i + 1) % size === 0
		if (endOfChunk && i < items.length - 1) await yieldFn()
	}
}
