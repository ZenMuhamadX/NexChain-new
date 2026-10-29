import { RpcClientError } from './rpcClient'

/**
 * Decoder field hex berisi teks (`extraData`, `coinbase.extraData`, `data`).
 *
 * Protokol v0.1 mendefinisikan `data` sebagai **hex UTF-8**, jadi decoder
 * utama memakai `TextDecoder` (bukan `String.fromCharCode` per pasangan).
 * Perbedaan ini nyata untuk karakter non-ASCII: encoder lama menulis satu
 * code unit UTF-16 per pasangan hex, sehingga teks seperti "é" atau emoji
 * menghasilkan byte yang bukan UTF-8 valid.
 *
 * Karena itu ada fallback: bila byte bukan UTF-8 valid (node lama), decode
 * dilakukan per code unit seperti encoder lama. Fallback hanya menjaga
 * kompatibilitas tampilan — bukan cara yang benar untuk data baru.
 */
export function hexToString(hex: string): string {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex
	if (clean.length === 0) return ''
	if (clean.length % 2 !== 0) {
		throw new RpcClientError('decode', 'Invalid hex response.')
	}

	const bytes = new Uint8Array(clean.length / 2)
	for (let i = 0; i < clean.length; i += 2) {
		const code = Number.parseInt(clean.slice(i, i + 2), 16)
		if (Number.isNaN(code)) {
			throw new RpcClientError('decode', 'Invalid hex response.')
		}
		bytes[i / 2] = code
	}

	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		let output = ''
		for (let i = 0; i < clean.length; i += 2) {
			output += String.fromCharCode(Number.parseInt(clean.slice(i, i + 2), 16))
		}
		return output
	}
}

/**
 * Decode field hex berisi teks (mis. `extraData`, `coinbase.extraData`).
 * Kembalikan null bila bukan teks printable — caller lalu menampilkan
 * hex mentahnya.
 */
export function tryHexText(hex: string | undefined | null): string | null {
	if (!hex || typeof hex !== 'string') return null
	try {
		const text = hexToString(hex)
		for (let i = 0; i < text.length; i += 1) {
			const code = text.charCodeAt(i)
			const printable = code >= 0x20 && code <= 0x7e // ASCII printable
			if (!printable && text[i] !== '\n' && text[i] !== '\t') return null
		}
		return text
	} catch {
		return null
	}
}
