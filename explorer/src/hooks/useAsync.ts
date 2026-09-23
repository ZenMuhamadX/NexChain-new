import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type DependencyList,
} from 'react'

export interface AsyncState<T> {
	data: T | undefined
	error: unknown
	loading: boolean
	refresh: () => void
}

interface UseAsyncOptions {
	/** Interval auto-refresh (ms). Berhenti saat tab tersembunyi. */
	pollMs?: number
	/** Set false untuk menunda fetch (mis. menunggu data lain). Default true. */
	enabled?: boolean
}

/**
 * Fetch generik dengan auto-refresh yang sadar visibility.
 *
 * - Saat pollMs di-set, interval hanya berjalan ketika tab terlihat dan
 *   langsung refresh begitu tab kembali fokus (hemat rate limit 10k/15min).
 * - Error pada poll TIDAK menghapus data lama — UI tetap menampilkan data
 *   terakhir yang sukses; error hanya dipakai bila data belum pernah ada.
 */
export function useAsync<T>(
	fetcher: () => Promise<T>,
	deps: DependencyList,
	options: UseAsyncOptions = {},
): AsyncState<T> {
	const { pollMs, enabled = true } = options
	const [data, setData] = useState<T | undefined>(undefined)
	const [error, setError] = useState<unknown>(undefined)
	const [loading, setLoading] = useState(true)
	const [tick, setTick] = useState(0)
	const fetcherRef = useRef(fetcher)
	fetcherRef.current = fetcher

	const refresh = useCallback(() => setTick((value) => value + 1), [])

	useEffect(() => {
		if (!enabled) return undefined

		let cancelled = false
		let timer: ReturnType<typeof setTimeout> | undefined

		const run = async (initial: boolean) => {
			if (initial) setLoading(true)
			try {
				const result = await fetcherRef.current()
				if (cancelled) return
				setData(result)
				setError(undefined)
			} catch (caught) {
				if (cancelled) return
				setError(caught)
			} finally {
				if (!cancelled && initial) setLoading(false)
			}
		}

		const schedule = () => {
			if (!pollMs || cancelled) return
			timer = setTimeout(() => {
				void (async () => {
					if (document.visibilityState === 'visible') await run(false)
					schedule()
				})()
			}, pollMs)
		}

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') void run(false)
		}

		void run(true)
		if (pollMs) {
			schedule()
			document.addEventListener('visibilitychange', onVisibilityChange)
		}

		return () => {
			cancelled = true
			if (timer) clearTimeout(timer)
			document.removeEventListener('visibilitychange', onVisibilityChange)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, tick, enabled, pollMs])

	return { data, error, loading, refresh }
}
