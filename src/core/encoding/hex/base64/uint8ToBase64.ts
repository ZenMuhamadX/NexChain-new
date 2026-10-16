/**
 * Panjang potongan untuk `String.fromCharCode(...)`.
 *
 * `String.fromCharCode` menerima byte sebagai ARGUMEN, dan jumlah argumen
 * dibatasi mesin JS. Menyebar seluruh payload sekaligus aman untuk transaksi
 * (~150 byte) tetapi MELEMPAR `RangeError` untuk blok: RLP blok bisa ratusan
 * kilobyte, jauh di atas batas ~125 ribu argumen. Batas ini juga diuji
 * `bun run check:p2p` dengan payload besar.
 */
const CHUNK_SIZE = 0x2000 // 8 KiB

export const uint8ToBase64 = (data: Uint8Array) => {
	let binary = ''
	for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
		binary += String.fromCharCode(...data.subarray(offset, offset + CHUNK_SIZE))
	}
	return btoa(binary)
}
