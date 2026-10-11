/**
 * RLP (Recursive Length Prefix) — encoder.
 *
 * RLP adalah skema serialisasi biner milik Ethereum. Ia hanya mengenal DUA
 * jenis nilai:
 *
 *   - byte string  → `Uint8Array`
 *   - list         → array (rekursif) dari dua jenis ini
 *
 * Tidak ada nama field, tidak ada tanda kutip, tidak ada pemisah. Karena itu
 * RLP bersifat **kanonik**: satu nilai selalu menghasilkan satu representasi
 * byte yang persis sama, dan urutan field ditentukan oleh POSISI di dalam
 * list. Inilah alasan RLP dipakai sebagai format wire transaksi di sini.
 *
 * Aturan encoding (spesifikasi Ethereum, yellow paper appendix B):
 *
 *   string 1 byte 0x00..0x7f → byte itu sendiri
 *   string 0..55 byte        → 0x80 + panjang, lalu byte-nya
 *   string >55 byte          → 0xb7 + panjang-dari-panjang, panjang, byte
 *   list payload 0..55 byte  → 0xc0 + panjang, lalu payload
 *   list payload >55 byte    → 0xf7 + panjang-dari-panjang, panjang, payload
 *
 * Modul ini murni (tanpa I/O, tanpa dependency, tanpa Node API) sehingga aman
 * di-bundle ke wallet browser. Dijaga oleh `bun run check:browser`.
 */

/** Nilai yang bisa di-encode RLP: byte string atau list (rekursif). */
export type RlpInput = Uint8Array | RlpInput[]

/** Gabung beberapa Uint8Array jadi satu tanpa Buffer (agar browser-safe). */
const concatBytes = (parts: Uint8Array[]): Uint8Array => {
	let total = 0
	for (const part of parts) total += part.length

	const out = new Uint8Array(total)
	let offset = 0
	for (const part of parts) {
		out.set(part, offset)
		offset += part.length
	}
	return out
}

/**
 * Encode "panjang" menjadi header RLP.
 * `offset` adalah basis prefix: 0x80 untuk string, 0xc0 untuk list.
 */
const encodeLength = (length: number, offset: number): Uint8Array => {
	// Panjang pendek: langsung satu byte.
	if (length < 56) return new Uint8Array([length + offset])

	// Panjang besar: panjangnya sendiri ditulis big-endian minimal.
	const sizeBytes: number[] = []
	let remaining = length
	while (remaining > 0) {
		sizeBytes.unshift(remaining % 256)
		remaining = Math.floor(remaining / 256)
	}
	return new Uint8Array([offset + 55 + sizeBytes.length, ...sizeBytes])
}

const encodeBytes = (bytes: Uint8Array): Uint8Array => {
	// Satu byte tunggal di bawah 0x80 sudah menjadi representasi dirinya.
	if (bytes.length === 1 && bytes[0] < 0x80) return bytes
	return concatBytes([encodeLength(bytes.length, 0x80), bytes])
}

const encodeList = (items: RlpInput[]): Uint8Array => {
	const payload = concatBytes(items.map((item) => rlpEncode(item)))
	return concatBytes([encodeLength(payload.length, 0xc0), payload])
}

/** Encode satu nilai RLP menjadi byte. */
export const rlpEncode = (input: RlpInput): Uint8Array =>
	input instanceof Uint8Array ? encodeBytes(input) : encodeList(input)
