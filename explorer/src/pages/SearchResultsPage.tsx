import { Navigate, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import { classifyQuery } from '../lib/classify'
import { useAsync } from '../hooks/useAsync'
import { EmptyState, ErrorState, LoadingState } from '../components/common/States'
import { Link } from 'react-router-dom'

/**
 * Resolver hasil pencarian:
 * - height  → redirect ke /block/{height}
 * - address → redirect ke /address/{address}
 * - hash    → coba blok dulu, fallback transaksi, dua-duanya miss → "no results"
 * - lainnya → "no results"
 *
 * Semua cabang bisa dibuka langsung sebagai URL — resolver tidak
 * bergantung pada SearchBar.
 */
export function SearchResultsPage() {
	const { query = '' } = useParams()

	// — redirect untuk height & address (sinkron) —
	const kind = classifyQuery(query)
	if (kind === 'height') return <Navigate to={`/block/${query}`} replace />
	if (kind === 'address') return <Navigate to={`/address/${query}`} replace />

	// — hash: resolve async (atau langsung no-results untuk query aneh) —
	const isHash = kind === 'hash'
	const { data, error, loading, refresh } = useAsync(
		async () => {
			if (!isHash) return { block: false, tx: false }
			const hash = query.replace(/^0x/, '')
			const block = await rpc.getBlockByHash(hash).catch(() => undefined)
			if (block) return { block: true, tx: false }
			const tx = await rpc.getTransactionByHash(hash).catch(() => undefined)
			return { block: false, tx: Boolean(tx) }
		},
		[query, isHash],
	)

	if (isHash && loading && !data) return <LoadingState label="Resolving hash…" />

	if (isHash && error && !data && !isNotFound(error)) {
		return <ErrorState error={error} onRetry={refresh} />
	}

	if (data?.block) return <Navigate to={`/block/${query.replace(/^0x/, '')}`} replace />
	if (data?.tx) return <Navigate to={`/tx/${query.replace(/^0x/, '')}`} replace />

	return (
		<div className="page">
			<EmptyState
				title="No results found"
				hint={
					<>
						Nothing on NexChain matches <code>{query}</code>.
						<br />
						Try a block height (e.g. <Link to="/block/1">1</Link>), a 64-char
						block/tx hash, or an address starting with <code>NxC</code> /{' '}
						<code>NxS</code>.
					</>
				}
				action={
					<button type="button" className="btn" onClick={refresh}>
						Retry
					</button>
				}
			/>
		</div>
	)
}
