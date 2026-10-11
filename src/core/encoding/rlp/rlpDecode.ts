/**
 * RLP (Recursive Length Prefix) — decoder.
 *
 * Pasangan dari `rlpEncode.ts`. Mengembalikan struktur `RlpInput` yang sama:
 * `Uint8Array` untuk byte string, array untuk list.
 *
 * Semua akses ke `data` diperiksa batasnya. Payload yang terpotong, panjang
 * yang melewati akhir data, atau byte sisa setelah item utama akan MELEMPAR
 * error — bukan menghasilkan nilai yang salah secara diam-diam. Itu penting:
 * payload rusak dari jaringan harus ditolak keras, bukan di-parse setengah.
 *
 * Catatan kanonisitas: decoder ini menerima encoding yang valid secara
 * struktural. Ia tidak menolak bentuk non-minimal (mis. panjang yang ditulis
 * dengan byte nol di depan) — payload yang kita hasilkan sendiri selalu
 * minimal, dan pemeriksaan tambahan ada di lapisan skema (`txCodec`).
 */

import type { RlpInput } from './rlpEncode'

interface Decoded {
	value: RlpInput
	consumed: number
}

/** Baca panjang big-endian sepanjang `size` byte. */
const readLength = (data: Uint8Array, start: number, size: number): number => {
	if (start + size > data.length) {
		throw new Error('RLP: prefix panjang melewati akhir data')
	}
	let length = 0
	for (let i = 0; i < size; i++) length = length * 256 + data[start + i]
	return length
}

/** Decode isi list yang sudah diketahui panjang payload-nya. */
const decodeList = (
	data: Uint8Array,
	start: number,
	length: number,
	headerSize: number,
): Decoded => {
	const end = start + length
	if (end > data.length) throw new Error('RLP: payload list melewati akhir data')

	const items: RlpInput[] = []
	let cursor = start
	while (cursor < end) {
		const item = decodeItem(data, cursor)
		if (cursor + item.consumed > end) {
			throw new Error('RLP: item melewati batas list')
		}
		items.push(item.value)
		cursor += item.consumed
	}
	return { value: items, consumed: headerSize + length }
}

/** Decode satu item mulai dari `start`. */
const decodeItem = (data: Uint8Array, start: number): Decoded => {
	if (start >= data.length) throw new Error('RLP: data berakhir tak terduga')
	const prefix = data[start]

	// Byte tunggal 0x00..0x7f.
	if (prefix < 0x80) {
		return { value: data.slice(start, start + 1), consumed: 1 }
	}

	// String pendek: 0x80..0xb7.
	if (prefix < 0xb8) {
		const length = prefix - 0x80
		if (start + 1 + length > data.length) {
			throw new Error('RLP: string pendek melewati akhir data')
		}
		return {
			value: data.slice(start + 1, start + 1 + length),
			consumed: 1 + length,
		}
	}

	// String panjang: 0xb8..0xbf.
	if (prefix < 0xc0) {
		const size = prefix - 0xb7
		const length = readLength(data, start + 1, size)
		const from = start + 1 + size
		if (from + length > data.length) {
			throw new Error('RLP: string panjang melewati akhir data')
		}
		return {
			value: data.slice(from, from + length),
			consumed: 1 + size + length,
		}
	}

	// List pendek: 0xc0..0xf7.
	if (prefix < 0xf8) {
		const length = prefix - 0xc0
		return decodeList(data, start + 1, length, 1)
	}

	// List panjang: 0xf8..0xff.
	const size = prefix - 0xf7
	const length = readLength(data, start + 1, size)
	const from = start + 1 + size
	return decodeList(data, from, length, 1 + size)
}

/**
 * Decode satu nilai RLP. Melempar bila data terpotong atau ada byte sisa.
 */
export const rlpDecode = (data: Uint8Array): RlpInput => {
	const decoded = decodeItem(data, 0)
	if (decoded.consumed !== data.length) {
		throw new Error('RLP: ada byte sisa setelah item utama')
	}
	return decoded.value
}
