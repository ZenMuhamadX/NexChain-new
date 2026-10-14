import { Link, Navigate, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { isNotFound } from '../api/rpcClient'
import { classifyQuery } from '../lib/classify'
import { useAsync } from '../hooks/useAsync'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from '../components/common/States'

/**
 * Resolver hasil pencarian:
 * - height  → redirect ke /block/{height}
 * - address → redirect ke /address/{address}
 * - hash    → coba blok dulu, fallback transaksi, dua-duanya miss → "no results"
 * - lainnya → "no results"
 *
 * Semua cabang bisa dibuka langsung sebagai URL — resolver tidak
 * bergantung pada SearchBar.
 *
 * Catatan: semua hook dipanggil TANPA syarat di atas. Versi lama melakukan
 * `return <Navigate>` sebelum `useAsync`, sehingga berpindah dari query
 * height ke query hash (komponen tetap mount) mengubah jumlah hook dan
 * membuat React melempar "Rendered more hooks than during the previous render".
 */
export function SearchResultsPage() {
	const { query = '' } = useParams()
	useDocumentTitle(`Search: ${query}`)

	const kind = classifyQuery(query)
	const isHash = kind === 'hash'

	const { data, error, loading, refresh } = useAsync(async () => {
		if (!isHash) return { block: false, tx: false }
		const hash = query.replace(/^0x/, '')
		const block = await rpc.getBlockByHash(hash).catch(() => undefined)
		if (block) return { block: true, tx: false }
		const tx = await rpc.getTransactionByHash(hash).catch(() => undefined)
		return { block: false, tx: Boolean(tx) }
	}, [query, isHash])

	// — tujuan redirect, dihitung setelah semua hook —
	if (kind === 'height') return <Navigate to={`/block/${query}`} replace />
	if (kind === 'address') return <Navigate to={`/address/${query}`} replace />
	if (data?.block) {
		return <Navigate to={`/block/${query.replace(/^0x/, '')}`} replace />
	}
	if (data?.tx)
		return <Navigate to={`/tx/${query.replace(/^0x/, '')}`} replace />

	if (isHash && loading && !data)
		return <LoadingState label="Resolving hash…" />

	if (isHash && error && !data && !isNotFound(error)) {
		return <ErrorState error={error} onRetry={refresh} />
	}

	return (
		<div className="page">
			<div className="page-head">
				<div>
					<h1>No results for “{query}”</h1>
					<p className="muted">
						Nothing on NexChain matches <code>{query}</code>.
					</p>
				</div>
			</div>

			<section className="panel">
				<EmptyState
					title="Try one of these instead"
					hint="Search accepts a block height, a 64-character block hash, a TxC… transaction hash, or an address starting with NxC / NxS."
					action={
						<div className="empty-actions">
							<Link className="btn btn-primary" to="/blocks">
								Browse blocks
							</Link>
							<Link className="btn" to="/mempool">
								View mempool
							</Link>
							<Link className="btn" to="/block/1">
								Go to block 1
							</Link>
						</div>
					}
				/>
			</section>
		</div>
	)
}
