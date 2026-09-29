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

/**
 * Presisi penuh (8 desimal) untuk disclosure/copy.
 *
 * CATATAN PORT: `AmountDisplay.tsx` (dari wallet-ui) mengimpor
 * `formatNxcCompact`, `formatNxcExact`, dan `formatNexu` — ketiganya BELUM
 * ada di `wallet-ui/src/lib/format.ts` (latent bug di repo asal). Di sini
 * ketiganya diimplementasikan di atas `formatNxc` vendored supaya aturan
 * presisi tetap identik dengan node/explorer.
 */
export const formatNxcExact = (nexu: number): string => formatNxc(nexu)

/** Ringkas: batasi digit desimal, buang nol di ekor. */
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

/**
 * Kelompokkan bagian bulat dengan pemisah ribuan gaya Indonesia (titik).
 *
 * HANYA untuk tampilan: nilai yang dipakai berhitung, disalin, atau
 * dikirim ke node harus tetap `formatNxcExact`/`formatNxcCompact` mentah.
 * Angka seperti `1234567,89` jauh lebih sulit dibaca sekilas daripada
 * `1.234.567,89` — dan di dompet, salah baca jumlah adalah kesalahan mahal.
 *
 * Aman terhadap string negatif dan string yang bukan angka (dikembalikan
 * apa adanya lewat pemeriksaan regex).
 */
export const groupThousands = (value: string): string => {
	const match = /^(-?)(\d+)(.*)$/.exec(value)
	if (!match) return value
	const [, sign, whole, rest] = match
	return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${rest}`
}

/**
 * Versi `formatNxcCompact` dengan pemisah ribuan — untuk teks yang dibaca
 * manusia (saldo, jumlah transaksi).
 */
export const formatNxcDisplay = (nexu: number, maxDecimals = 6): string =>
	groupThousands(formatNxcCompact(nexu, maxDecimals))

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
