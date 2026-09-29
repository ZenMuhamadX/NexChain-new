import { sha256 as jsSha256 } from 'js-sha256'

/**
 * Konversi hex string ke Uint8Array.
 * Pengganti Buffer.from(hex, 'hex') agar modul ini bebas Node API
 * dan tetap jalan di browser.
 * Hasilnya di-annotate `Uint8Array<ArrayBuffer>` (bukan `Uint8Array` polos =
 * `Uint8Array<ArrayBufferLike>`) karena API Web Crypto (crypto.subtle)
 * menerima `BufferSource` yang hanya memuat `ArrayBuffer` — bukan
 * `SharedArrayBuffer`.
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
 * SHA-256 murni-JS (js-sha256).
 *
 * Sebelumnya memakai Node `crypto`, yang GAGAL di browser
 * ("Module crypto has been externalized").
 * Hasil hex dijamin identik dengan crypto.createHash('sha256').digest('hex'),
 * sehingga txHash / merkleRoot / address yang sudah ada TIDAK berubah.
 */
export const sha256 = (
	data: string,
	enc: 'hex' | 'buffer',
): string | Uint8Array => {
	const hex = jsSha256(data)
	return enc === 'hex' ? hex : hexToBytes(hex)
}
