import { NEXU_PER_NXC } from 'src/core/token/constants'

/** Ubah pesan error apa pun menjadi string pendek yang bisa ditampilkan. */
export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

/** Format hashrate bergaya miner CLI (kH/s / MH/s). */
export const formatHashrate = (hashesPerSecond: number): string => {
	if (!Number.isFinite(hashesPerSecond) || hashesPerSecond <= 0) return '0 H/s'
	if (hashesPerSecond >= 1_000_000)
		return `${(hashesPerSecond / 1_000_000).toFixed(2)} MH/s`
	if (hashesPerSecond >= 1_000)
		return `${(hashesPerSecond / 1_000).toFixed(1)} kH/s`
	return `${hashesPerSecond.toFixed(0)} H/s`
}

/** Bilangan bulat dengan pemisah ribuan. */
export const formatCount = (value: number): string =>
	Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0'

/**
 * Saldo dari nexu (satuan on-chain, bilangan bulat) ke NXC yang terbaca.
 *
 * Presisi penuh dipertahankan (maks 8 desimal) — pembulatan hanya untuk
 * tampilan, nilai mentah tetap tersedia lewat detail bila diperlukan.
 */
export const formatNxc = (nexu: number): string => {
	if (!Number.isFinite(nexu)) return '0 NXC'
	const nxc = nexu / NEXU_PER_NXC
	return `${nxc.toLocaleString('en-US', { maximumFractionDigits: 8 })} NXC`
}

/** Potong hash panjang untuk tampilan (mis. `a1b2c3d4e5…9f8e7d`). */
export const shortHash = (hash: string, head = 10, tail = 6): string =>
	hash.length > head + tail + 1
		? `${hash.slice(0, head)}…${hash.slice(-tail)}`
		: hash

/** Durasi ringkas: `8.4s`, `1m 23s`, `2j 5m`. */
export const formatDuration = (ms: number): string => {
	if (!Number.isFinite(ms) || ms < 0) return '—'
	const totalSeconds = ms / 1000
	if (totalSeconds < 60)
		return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = Math.round(totalSeconds % 60)
	if (minutes < 60) return `${minutes}m ${seconds}s`
	return `${Math.floor(minutes / 60)}j ${minutes % 60}m`
}

/** Jam:menit:detik dari epoch ms. */
export const formatClock = (timestampMs: number): string =>
	new Date(timestampMs).toLocaleTimeString('en-GB')
