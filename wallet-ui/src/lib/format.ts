import { formatNxc as formatNxcExactString } from 'nexchain/nexucoin/formatNxc'

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
