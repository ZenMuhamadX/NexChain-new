import { sha256 as jsSha256 } from 'js-sha256'

/**
 * Konversi hex string ke Uint8Array.
 * Pengganti Buffer.from(hex, 'hex') agar modul ini bebas Node API
 * dan tetap jalan di browser.
 * Hasilnya di-annotate `Uint8Array<ArrayBuffer>` (bukan `Uint8Array` polos =
 * `Uint8Array<ArrayBufferLike>`) karena API Web Crypto (crypto.subtle)
 * menerima `BufferSource` yang hanya memuat `ArrayBuffer` — bukan
 * `SharedArrayBuffer`.
 *
 * Catatan: fungsi ini LENIENT (prefix `0x` dibuang, hex rusak jadi NaN).
 * Untuk input yang dipercaya (mis. payload PoW dari wire) pakai
 * `hexToBytesStrict` — lihat di bawah.
 */
export const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex
	const out = new Uint8Array(clean.length >> 1)
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

/**
 * Hex ketat (tanpa prefix `0x`) → byte. Fail-closed: panjang ganjil atau
 * karakter non-hex MELEMPAR, bukan menghasilkan byte NaN. Dipakai payload
 * PoW yang datang dari wire — di sana decoding yang diam-diam salah berarti
 * hash yang tidak pernah cocok.
 */
export const hexToBytesStrict = (hex: string): Uint8Array<ArrayBuffer> => {
	if (typeof hex !== 'string') {
		throw new Error('hexToBytesStrict: input harus string')
	}
	if (hex.length % 2 !== 0) {
		throw new Error(`hexToBytesStrict: panjang hex ganjil (${hex.length})`)
	}
	if (!/^[0-9a-fA-F]*$/.test(hex)) {
		throw new Error('hexToBytesStrict: karakter non-hex')
	}
	const out = new Uint8Array(hex.length >> 1)
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

/**
 * SHA-256 murni-JS (js-sha256).
 *
 * Sebelumnya memakai Node `crypto`, yang GAGAL di browser
 * ("Module crypto has been externalized").
 * Hasil hex dijamin identik dengan crypto.createHash('sha256').digest('hex'),
 * sehingga txHash / merkleRoot / address yang sudah ada TIDAK berubah.
 *
 * Menerima `Uint8Array` juga (js-sha256 mendukungnya secara native) — ini
 * yang dipakai jalur transaksi, karena preimage-nya byte RLP. Mengubah byte
 * menjadi string lebih dulu akan SALAH: UTF-8 akan meng-encode ulang byte
 * >= 0x80 menjadi dua byte.
 */
export const sha256 = (
	data: string | Uint8Array,
	enc: 'hex' | 'buffer',
): string | Uint8Array => {
	const hex = jsSha256(data)
	return enc === 'hex' ? hex : hexToBytes(hex)
}

/**
 * SHA-256 ganda (`SHA256(SHA256(data))`) sebagai hex big-endian.
 *
 * Ini primitif PoW NexChain sejak fork `pow-bytes`: `hash = SHA256d(payload)`
 * dengan `payload` byte dari `buildMiningPayload`. Hanya memakai js-sha256 —
 * TIDAK ada `node:crypto` di jalur shared core, supaya modul ini tetap bisa
 * di-bundle ke wallet browser (`check:browser`).
 *
 * Hex yang dikembalikan adalah urutan byte digest APA ADANYA (big-endian),
 * bukan konvensi tampilan Bitcoin yang dibalik. Pembandingan target
 * (`meetsDifficulty`) juga memakai urutan ini — jangan dibalik.
 */
export const sha256d = (data: Uint8Array): string => {
	const first = jsSha256.array(data)
	const second = jsSha256.array(new Uint8Array(first))
	let hex = ''
	for (const byte of second) hex += byte.toString(16).padStart(2, '0')
	return hex
}
