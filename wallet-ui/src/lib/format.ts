/** Pemotongan string alamat/hash untuk tampilan ringkas. */
export const truncate = (value: string, head = 10, tail = 8): string =>
	value.length <= head + tail + 1
		? value
		: `${value.slice(0, head)}…${value.slice(-tail)}`

interface NxcParts {
	negative: string
	whole: string
	fraction: string
}

const splitNxc = (nexu: number): NxcParts | undefined => {
	if (!Number.isFinite(nexu)) return undefined
	const negative = nexu < 0 ? '-' : ''
	const abs = Math.abs(nexu)
	let integer: string
	try {
		integer = BigInt(Math.trunc(abs)).toString()
	} catch {
		integer = Math.trunc(abs).toString()
	}
	const padded = integer.padStart(19, '0')
	return {
		negative,
		whole: padded.slice(0, -18) || '0',
		fraction: padded.slice(-18).replace(/0+$/, ''),
	}
}

/**
 * Format saldo nexu → NXC dengan presisi penuh 18 desimal.
 * Nilai ini dipakai pada detail/transaksi teknis, bukan primary display.
 */
export const formatNxc = (nexu: number): string => {
	const parts = splitNxc(nexu)
	if (!parts) return '—'
	return parts.fraction
		? `${parts.negative}${parts.whole}.${parts.fraction}`
		: `${parts.negative}${parts.whole}`
}

export const formatNxcExact = formatNxc

const groupInteger = (value: string): string =>
	value.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/**
 * Format ringkas untuk UI: maksimal `maxDecimals` desimal, trailing zero dihapus.
 * Nilai yang lebih kecil dari 1 desimal ditampilkan sebagai `<0,0001` agar
 * mobile tidak dipenuhi angka nol; nilai penuh tersedia di detail.
 */
export const formatNxcCompact = (nexu: number, maxDecimals = 4): string => {
	const parts = splitNxc(nexu)
	if (!parts) return '—'
	const decimals = Math.max(0, Math.min(18, Math.trunc(maxDecimals)))
	const threshold = decimals === 0 ? 1 : 10 ** -decimals
	const isTiny = parts.whole === '0' && Math.abs(nexu) > 0 && Math.abs(nexu) < threshold
	if (isTiny) return `<${threshold.toFixed(decimals).replace('.', ',')}`

	if (parts.fraction.length <= decimals) {
		return `${parts.negative}${groupInteger(parts.whole)}${
			parts.fraction ? `,${parts.fraction}` : ''
		}`
	}

	const visible = parts.fraction.slice(0, decimals).replace(/0+$/, '')
	if (!visible) {
		return parts.whole === '0'
			? `<${threshold.toFixed(decimals).replace('.', ',')}`
			: `${parts.negative}${groupInteger(parts.whole)}`
	}
	return `${parts.negative}${groupInteger(parts.whole)},${visible}`
}

/** Format integer nexu untuk panel detail. */
export const formatNexu = (nexu: number): string => {
	if (!Number.isFinite(nexu)) return '—'
	return Math.trunc(nexu).toLocaleString('id-ID')
}

export const formatTime = (ms: number): string =>
	new Date(ms).toLocaleString('id-ID', {
		dateStyle: 'medium',
		timeStyle: 'short',
	})

export const shortHash = (hash: string): string => truncate(hash, 12, 6)

/** Salin teks ke clipboard; false bila ditolak/tidak tersedia. */
export const copyText = async (text: string): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		return false
	}
}

/** Pesan error yang layak ditampilkan untuk exception apa pun. */
export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)
