/**
 * Cache pengirim transaksi — model geth `types.Sender` / `tx.from()`.
 *
 * geth menghitung `ecrecover` sekali lalu menyimpan hasilnya di objek tx;
 * pemanggil berikutnya memakai nilai itu. Di sini objek tx dibuat ulang setiap
 * decode (wire tidak membawa `from`), jadi cache-nya di-key `txHash`.
 * `txHash = sha256(payload)` mencakup v/r/s, jadi dua payload berbeda TIDAK
 * bisa saling memakai `from` — sama kuatnya dengan content-addressing blok.
 *
 * Batas LRU hanya pengaman memori (bukan aturan konsensus): cukup untuk
 * mempool `MAX_MEMPOOL_TX` (4096) + beberapa blok penuh yang dibaca ulang.
 * Cache hit dilempar ke ujung agar entri lama yang keluar duluan.
 */
const MAX_ENTRIES = 8192

const senders = new Map<string, string>()

/** `from` yang sudah terverifikasi, atau `undefined` bila belum ada. */
export const getCachedSender = (txHash: string): string | undefined => {
	const from = senders.get(txHash)
	if (from === undefined) return undefined
	// Touch: Map.insertion order dipakai sebagai urutan LRU.
	senders.delete(txHash)
	senders.set(txHash, from)
	return from
}

/** Simpan `from` hasil pemulihan pertama untuk `txHash` ini. */
export const rememberSender = (txHash: string, from: string): void => {
	if (senders.has(txHash)) senders.delete(txHash)
	senders.set(txHash, from)
	if (senders.size > MAX_ENTRIES) {
		const oldest = senders.keys().next().value
		if (oldest !== undefined) senders.delete(oldest)
	}
}
