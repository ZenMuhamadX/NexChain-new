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

/** Decode hasil RPC berformat hex → JSON. */
export function decodeHexJson<T>(value: unknown): T {
	if (typeof value !== 'string') {
		throw new RpcClientError(
			'invalid-response',
			'Expected a hex-encoded JSON response from the NexChain RPC.',
		)
	}
	try {
		return JSON.parse(hexToString(value)) as T
	} catch (error) {
		if (error instanceof RpcClientError) throw error
		throw new RpcClientError(
			'decode',
			'The hex response did not contain valid JSON.',
		)
	}
}

/** Decode hasil RPC berformat hex → string biasa (mis. saldo "… NXC"). */
export function decodeHexString(value: unknown): string {
	if (typeof value !== 'string') {
		throw new RpcClientError(
			'invalid-response',
			'Expected a hex-encoded string response from the NexChain RPC.',
		)
	}
	return hexToString(value)
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
