/** Pemotongan string alamat/hash untuk tampilan ringkas. */
export const truncate = (value: string, head = 10, tail = 8): string =>
	value.length <= head + tail + 1
		? value
		: `${value.slice(0, head)}…${value.slice(-tail)}`

/**
 * Format saldo nexu → NXC dengan presisi penuh 18 desimal, TANPA artefak
 * floating point.
 *
 * `toNexu`/`toNxc` memakai pembagian float (`5e20 / 1e18`) yang untuk nilai
 * besar aman, tetapi `toFixed(18)` pada angka besar bisa menghasilkan ekor
 * palsu. Karena `amount`/`balance` dijamin bilangan bulat (isNexu), konversi
 * lewat BigInt → string desimal murni: 500 NXC tampil persis "500",
 * 0.5 NXC persis "0.5".
 */
export const formatNxc = (nexu: number): string => {
	if (!Number.isFinite(nexu)) return '—'
	const negative = nexu < 0 ? '-' : ''
	const abs = Math.abs(nexu)
	let integer: string
	try {
		integer = BigInt(Math.trunc(abs)).toString()
	} catch {
		integer = Math.trunc(abs).toString()
	}
	// 1 digit integer minimum + 18 digit desimal
	const padded = integer.padStart(19, '0')
	const whole = padded.slice(0, -18) || '0'
	const fraction = padded.slice(-18).replace(/0+$/, '')
	return fraction ? `${negative}${whole}.${fraction}` : `${negative}${whole}`
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

/** Pesan error yang layak tampilkan untuk exception apa pun. */
export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)
