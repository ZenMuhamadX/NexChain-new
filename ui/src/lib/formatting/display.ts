export function shortHash(value: string, length = 16): string { return value.length <= length ? value : `${value.slice(0, length / 2)}…${value.slice(-length / 2)}` }
/** NexChain generates timestamps with Date.now(), so values are milliseconds. */
export function formatTimestamp(timestamp: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(timestamp)) }
export async function copyText(value: string): Promise<void> { await navigator.clipboard.writeText(value) }
export function formatStoredNexu(value: number): string { return Number.isSafeInteger(value) ? `${(value / 1e18).toLocaleString(undefined, { maximumFractionDigits: 18 })} NXC` : `${value} NEXU (raw)` }
