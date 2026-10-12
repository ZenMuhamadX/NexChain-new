import { formatNxc as formatNxcExactString } from 'src/core/token/formatNxc'

/** Pemotongan string alamat/hash untuk tampilan ringkas. */
export const truncate = (value: string, head = 10, tail = 8): string =>
	value.length <= head + tail + 1
		? value
		: `${value.slice(0, head)}…${value.slice(-tail)}`

/**
 * Format saldo nexu → NXC dengan presisi penuh (8 desimal), TANPA artefak
 * floating point.
 *
 * Menyebarkan `nexchain/nexucoin/formatNxc` — sumber tunggal logika
 * konversi di seluruh paket. `toNxc`/`formatNexu` dulunya memakai
 * pembagian float (`5e20 / 1e18`) yang untuk nilai besar menghasilkan
 * ekor palsu saat `.toFixed(18)` dijalankan.
 *
 * Karena `amount`/`balance` dijamin bilangan bulat aman, konversi
 * murni pemotongan string: 500 NXC tampil persis "500",
 * 0.00025 NXC persis "0.00025".
 *
 * @param nexu Bilangan bulat aman dalam nexu.
 * @returns String desimal NXC tanpa satuan, atau `—` bila tidak aman.
 */
export const formatNxc = (nexu: number): string => {
	if (!Number.isSafeInteger(nexu)) return '—'
	return formatNxcExactString(nexu)
}

/**
 * Alias semantik untuk `formatNxc` — presisi penuh (8 desimal) untuk
 * disclosure/copy. Dipakai `AmountDisplay` pada dialog "NXC presisi penuh".
 */
export const formatNxcExact = (nexu: number): string => formatNxc(nexu)

/**
 * Ringkas: batasi digit desimal, buang nol di ekor. Cocok untuk label saldo
 * yang harus muat di mobile tanpa notasi ilmiah.
 *
 * @param nexu Bilangan bulat aman dalam nexu.
 * @param maxDecimals Batas atas digit desimal yang ditampilkan (default 6).
 * @returns String desimal NXC tanpa satuan, atau `—` bila tidak aman.
 */
export const formatNxcCompact = (nexu: number, maxDecimals = 6): string => {
	if (!Number.isSafeInteger(nexu)) return '—'
	if (nexu === 0) return '0'
	const exact = formatNxcExactString(nexu)
	const negative = exact.startsWith('-')
	const body = negative ? exact.slice(1) : exact
	const [whole, frac = ''] = body.split('.')
	const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, '')
	const out = trimmed.length > 0 ? `${whole}.${trimmed}` : whole
	// Nilai sangat kecil (mis. fee 25.000 nexu) bisa terpangkas jadi "0";
	// fallback ke presisi penuh daripada menampilkan 0 yang menyesatkan.
	if (out === '0' && body !== '0') return negative ? `-${body}` : body
	return negative ? `-${out}` : out
}

/** Nilai internal bersatuan nexu, mis. "25000 nexu". */
export const formatNexu = (nexu: number): string =>
	Number.isSafeInteger(nexu) ? `${nexu} nexu` : '—'

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
