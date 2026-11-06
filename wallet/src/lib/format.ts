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
 * Kelompokkan bagian bulat dengan titik tiap tiga digit ("12345" → "12.345").
 *
 * Manual, bukan `toLocaleString`: hasilnya harus sama di semua mesin dan
 * tidak bergantung pada data locale yang terpasang di browser pengguna.
 */
const groupThousands = (digits: string): string =>
	digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/**
 * Ubah string desimal gaya mesin ("12345.678", "-0.00025") menjadi tampilan
 * Indonesia ("12.345,678", "-0,00025").
 *
 * KENAPA dipisah dari `formatNxc`: `formatNxc` juga dipakai untuk MENGISI
 * kolom jumlah di layar Kirim, dan kolom itu dibaca kembali oleh `toNexu`
 * yang menuntut titik desimal tanpa pemisah ribuan. Kalau formatter mesinnya
 * ikut diubah, "10.000" akan terbaca 10 — bukan sepuluh ribu.
 *
 * Nilai yang bukan angka (mis. "—") dikembalikan apa adanya.
 */
export const formatNxcDisplay = (value: string): string => {
	if (!/^-?\d/.test(value)) return value
	const negative = value.startsWith('-')
	const body = negative ? value.slice(1) : value
	const [whole, frac] = body.split('.')
	const grouped = groupThousands(whole)
	const out = frac ? `${grouped},${frac}` : grouped
	return negative ? `-${out}` : out
}

/**
 * Alias semantik untuk `formatNxc` — presisi penuh (8 desimal) untuk
 * disclosure. Dipakai `AmountDisplay` pada dialog "NXC presisi penuh".
 *
 * Ditampilkan dalam format Indonesia (ribuan ".", desimal ","). Nilai mentah
 * dalam nexu tetap ditampilkan terpisah di dialog yang sama, jadi tidak ada
 * informasi yang hilang.
 */
export const formatNxcExact = (nexu: number): string =>
	formatNxcDisplay(formatNxc(nexu))

/**
 * Jumlah digit pecahan pada nilai PERSIS (0 = bilangan bulat).
 *
 * Sengaja dihitung dari string MESIN (`formatNxc`), bukan dari tampilan:
 * pada tampilan Indonesia titik adalah pemisah ribuan, sehingga memotong
 * "10.000" pada "." akan menghasilkan tiga digit pecahan yang tidak ada.
 * Nol di ekor sudah dibuang oleh `formatNxc`, jadi 10.000,3400 tetap 2.
 */
export const nxcFractionDigits = (nexu: number): number => {
	if (!Number.isSafeInteger(nexu)) return 0
	const exact = formatNxcExactString(nexu)
	const dot = exact.indexOf('.')
	return dot < 0 ? 0 : exact.length - dot - 1
}

/**
 * Bagian BULAT saja, dengan pemisah ribuan ("10.000"), tanpa pembulatan.
 *
 * Dipakai angka utama di kartu saldo: yang dibaca sekilas cukup bilangan
 * bulatnya, sisanya lewat tombol presisi. Sengaja MEMOTONG, bukan membulatkan
 * — saldo 10,99 yang tampil "11" akan membuat orang mencoba mengirim 11 dan
 * ditolak node. Menampilkan lebih sedikit tidak pernah menggagalkan transaksi.
 *
 * Pemanggil wajib memeriksa hasil "0": untuk saldo 0,00025 fungsi ini memang
 * mengembalikan "0", dan menampilkan angka itu sebagai saldo akan berbohong.
 * Lihat `AmountDisplay` — di sana kasus itu jatuh kembali ke tampilan ringkas.
 */
export const formatNxcWhole = (nexu: number): string => {
	if (!Number.isSafeInteger(nexu)) return '—'
	const exact = formatNxcExactString(nexu)
	const negative = exact.startsWith('-')
	const body = negative ? exact.slice(1) : exact
	const whole = body.split('.')[0] ?? '0'
	// "-0" bukan angka yang boleh muncul di layar.
	if (negative && !/[1-9]/.test(whole)) return groupThousands(whole)
	return negative ? `-${groupThousands(whole)}` : groupThousands(whole)
}

/**
 * Ringkas: batasi digit desimal, buang nol di ekor. Cocok untuk label saldo
 * yang harus muat di mobile tanpa notasi ilmiah.
 *
 * Hasilnya memakai format Indonesia ("10.000", "12.345,678") — pemisah ribuan
 * titik dan desimal koma — supaya konsisten dengan `formatNxcExact` dan tidak
 * pernah terbaca ambigu.
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
	const plain = trimmed.length > 0 ? `${whole}.${trimmed}` : whole
	// Nilai sangat kecil (mis. fee 25.000 nexu) bisa terpangkas jadi "0";
	// fallback ke presisi penuh daripada menampilkan 0 yang menyesatkan.
	if (plain === '0' && body !== '0')
		return formatNxcDisplay(negative ? `-${body}` : body)
	return formatNxcDisplay(negative ? `-${plain}` : plain)
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

/** Bilangan bulat dengan pemisah ribuan gaya Indonesia (1.180). */
export const formatCount = (value: number): string =>
	Number.isFinite(value) ? Math.trunc(value).toLocaleString('id-ID') : '—'

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
