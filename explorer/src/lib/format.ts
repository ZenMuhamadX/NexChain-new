/**
 * Jumlah desimal satuan — 1 NXC = 10^8 Nexu.
 *
 * Dirombak dari 10^18 ke 10^8 (gaya satoshi, 8 desimal) supaya seluruh
 * nilai on-chain berada di bawah `Number.MAX_SAFE_INTEGER` dan aritmetika
 * `number` kembali eksak. Contoh bug satuan lama: saldo terbaca
 * `100.00049999999901 NXC`.
 *
 * Paket ini dibangun berdiri sendiri dan TIDAK mengimpor `src/...`
 * (lihat vite.config.ts — backend tidak pernah ikut bundle), jadi logika
 * konversi diduplikasi di sini. PASTIKAN tetap sinkron dengan
 * `src/core/token/constants.ts` dan `src/core/token/formatNxc.ts`.
 */
const DECIMALS = 8

/** 1 NXC = 10^8 nexu. HARUS sama dengan `NEXU_PER_NXC` di node & wallet. */
export const NEXU_PER_NXC = 100_000_000

/** Plafon suplai, NXC. HARUS sama dengan `MAX_SUPPLY_NXC` di node. */
export const MAX_SUPPLY_NXC = 50_000_000

/**
 * nexu → string desimal **tanpa satu pun operasi floating point**.
 *
 * Memotong string pada posisi titik desimal yang tepat. Pembagian float
 * (`nexu / NEXU`) untuk nilai besar menghasilkan digit tambahan yang tidak
 * pernah ada di state.
 *
 * @returns String kanonik tanpa satuan, mis. `"0.00025"`, `"500"`, `"-1"`.
 *          Kosong bila `nexu` bukan bilangan bulat aman.
 */
const exactNxc = (nexu: number): string => {
	if (!Number.isSafeInteger(nexu)) return ''
	const negative = nexu < 0
	// String() pada bilangan bulat aman tidak pernah memakai notasi
	// eksponensial (baru terjadi di ≥ 1e21).
	const digits = String(Math.abs(nexu)).padStart(DECIMALS + 1, '0')
	const whole = digits.slice(0, -DECIMALS)
	const fraction = digits.slice(-DECIMALS).replace(/0+$/, '')
	const body = fraction.length > 0 ? `${whole}.${fraction}` : whole
	return negative ? `-${body}` : body
}

/** Pemisah ribuan gaya en-US: `1234567` → `1,234,567`. */
const groupThousands = (value: string): string =>
	value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Format ringkas dari string eksak — tetap tanpa float. */
const compactNxc = (exact: string, maxDecimals: number): string => {
	const negative = exact.startsWith('-')
	const body = negative ? exact.slice(1) : exact
	const [whole, fraction = ''] = body.split('.')
	const shortened = fraction.slice(0, maxDecimals).replace(/0+$/, '')
	const grouped = groupThousands(whole)
	const output =
		shortened.length > 0 ? `${grouped}.${shortened}` : grouped
	return negative ? `-${output}` : output
}

/** Format saldo/amount Nexu → NXC yang enak dibaca. */
export const formatNxc = (nexu: number, maxDecimals = 6): string => {
	const exact = exactNxc(nexu)
	// Non-integer / unsafe / NaN → tampilkan tanda pecah, jangan diam-diam
	// merender nilai yang salah.
	if (exact === '') return '—'
	if (exact === '0') return '0 NXC'

	const compact = compactNxc(exact, maxDecimals)
	// Nilai terlalu kecil untuk presisi tampilan ini (mis. fee 25.000 nexu
	// dengan maxDecimals=6 → "0") → tampilkan desimal penuh, jangan
	// melempar ke notasi ilmiah atau "0 NXC".
	if (compact.replace('-', '').replace(/[.,]/g, '') === '') {
		return `${exact} NXC`
	}
	return `${compact} NXC`
}

/** Presisi penuh (8 desimal) — untuk copy/tooltip. */
export const formatNxcExact = (nexu: number): string => {
	const exact = exactNxc(nexu)
	return exact === '' ? '—' : exact
}

/** Potong tengah: 000007cc…de65ad */
export const truncateMiddle = (value: string, head = 10, tail = 8): string => {
	if (!value) return '—'
	return value.length <= head + tail + 1
		? value
		: `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** Waktu relatif dari timestamp (ms): "32s ago", "5m ago", "2d ago". */
export const timeAgo = (timestampMs: number): string => {
	const diff = Date.now() - timestampMs
	if (!Number.isFinite(timestampMs)) return '—'
	if (diff < 5_000) return 'just now'
	const seconds = Math.floor(diff / 1000)
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

/** Timestamp (ms) → tanggal lokal lengkap. */
export const formatDateTime = (timestampMs: number): string => {
	if (!Number.isFinite(timestampMs)) return '—'
	return new Date(timestampMs).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'medium',
	})
}

/**
 * Timestamp (ms) → tanggal-waktu lokal ringkas 24 jam: `2024-09-28 19:00`.
 *
 * Dipakai di kartu ringkas (Chain Head) yang setiap barisnya dipatok satu
 * baris. `toLocaleString` mengeluarkan "Sep 28, 2024, 7:00:00 PM" — 24
 * karakter yang pecah jadi 2–4 baris di kolom sempit. Bentuk ISO ini hanya
 * 16 karakter dan karakternya sempit (angka), jadi muat di kolom kanan
 * kartu bahkan pada lebar layar tersempit saat kartu masih dua kolom
 * (1121px). Detik dibuang karena menambah ~19px; nilai lengkap tetap ada di
 * tooltip (`formatDateTime`) dan di halaman detail blok.
 *
 * Sengaja tidak memakai nama bulan/locale: UI explorer berbahasa Inggris,
 * sedangkan `toLocaleString` ikut locale mesin dan hasilnya campur bahasa.
 */
export const formatDateTimeCompact = (timestampMs: number): string => {
	if (!Number.isFinite(timestampMs)) return '—'
	const date = new Date(timestampMs)
	const pad = (n: number): string => String(n).padStart(2, '0')
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
		date.getDate(),
	)}`
	return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Angka dengan pemisah ribuan. */
export const formatNumber = (n: number): string =>
	Number.isFinite(n) ? new Intl.NumberFormat('en-US').format(n) : '—'

/** Ukuran blok (byte dari backend) → "820 B" / "0.87 KB" / "1.20 MB". */
export const formatSize = (bytes: number): string => {
	if (!Number.isFinite(bytes)) return '—'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** Durasi ms → "31.2s" / "1m 05s" — untuk rata-rata waktu blok. */
export const formatDuration = (ms: number): string => {
	if (!Number.isFinite(ms) || ms < 0) return '—'
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
	const minutes = Math.floor(ms / 60_000)
	const seconds = Math.round((ms % 60_000) / 1000)
	return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
