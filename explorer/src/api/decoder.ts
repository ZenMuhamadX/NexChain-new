import { RpcClientError } from './rpcClient'

/**
 * Decoder hex NexChain — cerminan persis dari `nexchain/hex/hexToString.ts`
 * (pasangan 2 digit hex → String.fromCharCode), BUKAN UTF-8 decode,
 * karena backend meng-encode dengan `charCodeAt` per karakter.
 */
export function hexToString(hex: string): string {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex
	let output = ''
	for (let i = 0; i < clean.length; i += 2) {
		const code = Number.parseInt(clean.slice(i, i + 2), 16)
		if (Number.isNaN(code)) {
			throw new RpcClientError('decode', 'Invalid hex response.')
		}
		output += String.fromCharCode(code)
	}
	return output
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
