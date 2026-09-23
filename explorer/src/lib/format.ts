/** 1 NXC = 10^18 Nexu — satuan bawaan seluruh state on-chain. */
const NEXU = 10 ** 18

/** Format saldo/amount Nexu → NXC yang enak dibaca. */
export const formatNxc = (nexu: number, maxDecimals = 6): string => {
	if (!Number.isFinite(nexu)) return '—'
	const value = nexu / NEXU
	if (value === 0) return '0 NXC'
	if (Math.abs(value) < 1e-6) return `${value.toExponential(3)} NXC`
	return `${new Intl.NumberFormat('en-US', {
		maximumFractionDigits: maxDecimals,
	}).format(value)} NXC`
}

/** Presisi penuh (18 desimal) — untuk copy/tooltip. */
export const formatNxcExact = (nexu: number): string => {
	if (!Number.isFinite(nexu)) return '—'
	return (nexu / NEXU).toFixed(18)
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

/** Angka dengan pemisah ribuan. */
export const formatNumber = (n: number): string =>
	Number.isFinite(n) ? new Intl.NumberFormat('en-US').format(n) : '—'

/** Ukuran blok (satuan KB dari backend) → "0.87 KB". */
export const formatSize = (kb: number): string => {
	if (!Number.isFinite(kb)) return '—'
	return `${kb.toFixed(2)} KB`
}

/** Durasi ms → "31.2s" / "1m 05s" — untuk rata-rata waktu blok. */
export const formatDuration = (ms: number): string => {
	if (!Number.isFinite(ms) || ms < 0) return '—'
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
	const minutes = Math.floor(ms / 60_000)
	const seconds = Math.round((ms % 60_000) / 1000)
	return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}
