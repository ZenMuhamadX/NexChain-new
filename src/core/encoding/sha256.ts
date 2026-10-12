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

/** Digit '0'..'9' sebagai byte ASCII — tabel kecil untuk menulis nonce. */
const ASCII_DIGITS = /* @__PURE__ */ (() => {
	const t = new Uint8Array(10)
	for (let i = 0; i < 10; i++) t[i] = 48 + i
	return t
})()

/**
 * Hasher PoW yang di-precompute untuk satu payload tetap.
 *
 * Ini adalah jalur PANAS Proof-of-Work: satu payload (preimage blok) di-hash
 * dengan ribuan / jutaan nonce berturut-turut. Implementasi naif
 * `sha256(`${payload}${nonce}`)` membayar tiga biaya berulang per iterasi —
 * number→string, concat string panjang, dan encoding UTF-8 oleh js-sha256 —
 * yang totalnya lebih mahal dari hashing itu sendiri.
 *
 * Kelas ini mengubah payload menjadi byte SEKALI, lalu tiap `hash(nonce)`
 * hanya menuliskan digit nonce ke buffer tetap (tanpa alokasi string, tanpa
 * GC), dan menghash `[payloadBytes ‖ nonceDigits]`.
 *
 * **Identik byte-per-byte** dengan `sha256(payload + nonce)` biasa:
 * `prepareBlockForHashing` selalu menghasilkan JSON dengan karakter printable
 * ASCII, dan `String(nonce)` juga ASCII, jadi encoding UTF-8 dari
 * `payload + nonce` persis sama dengan penggabungan byte di sini. Diverifikasi
 * oleh gate `check:pow` (lihat `scripts/powParityCheck.ts`).
 *
 * Catatan: hasher js-sha256 TIDAK dapat dipakai ulang antar-hash (state tidak
 * ter-reset), sehingga `create()` dipanggil per hash — itu memang wajib.
 */
export class PowHasher {
	private readonly payloadBytes: Uint8Array
	private readonly combined: Uint8Array
	private readonly base: number

	constructor(payload: string) {
		this.payloadBytes = new TextEncoder().encode(payload)
		this.base = this.payloadBytes.length
		// Ruang cukup untuk preimage + nonce desimal; 17 = digit maksimum
		// Number.MAX_SAFE_INTEGER (9007199254740991) ditambah margin.
		this.combined = new Uint8Array(this.base + 24)
		this.combined.set(this.payloadBytes, 0)
	}

	/** SHA-256(payload ‖ nonce) sebagai hex — sama dengan `sha256(payload+nonce)` */
	hash(nonce: number): string {
		const buf = this.combined
		const base = this.base
		let len = 0
		let n = nonce
		if (n === 0) {
			buf[base] = 48
			len = 1
		} else {
			// Tulis digit dari yang paling tidak signifikan, lalu balik di tempat.
			//
			// PENTING: pakai Math.floor(n / 10), BUKAN `(n / 10) | 0`. Operator
			// `| 0` memaksa int32 dan akan salah untuk nonce >= 2^31
			// (mis. Number.MAX_SAFE_INTEGER), menghasilkan digit yang keliru.
			while (n > 0) {
				buf[base + len++] = ASCII_DIGITS[n % 10]
				n = Math.floor(n / 10)
			}
			for (let i = base, j = base + len - 1; i < j; i++, j--) {
				const t = buf[i]
				buf[i] = buf[j]
				buf[j] = t
			}
		}
		const hasher = jsSha256.create()
		hasher.update(buf.subarray(0, base + len))
		return hasher.hex()
	}
}

/**
 * Bikin hasher PoW untuk satu payload. Pakai ini di loop mining — jangan panggil
 * `sha256` dengan concat string di dalam loop.
 */
export const createPowHasher = (payload: string): PowHasher =>
	new PowHasher(payload)
