import { Link, useSearchParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { BlockTable } from '../components/BlockTable'
import { PageSkeleton, SkeletonTable } from '../components/common/Skeleton'
import { EmptyState, ErrorState } from '../components/common/States'
import { useAsync } from '../hooks/useAsync'
import { useChain } from '../hooks/useChainState'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatNumber } from '../lib/format'

const PAGE_SIZE = 20
const POLL_MS = 10_000

export function BlocksPage() {
	useDocumentTitle('Blocks')
	const chain = useChain()
	const [params, setParams] = useSearchParams()

	const rawPage = Number.parseInt(params.get('page') ?? '1', 10)
	const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1

	const latest = chain.state?.currentBlockHeight
	const from =
		latest !== undefined ? latest - (page - 1) * PAGE_SIZE : undefined
	const inRange = from !== undefined && from >= 0

	// Polling: tanpa ini `timeAgo` membeku sampai user reload manual,
	// padahal chain terus berjalan di belakangnya.
	const blocks = useAsync(() => rpc.getBlocksRange(from!, PAGE_SIZE), [from], {
		enabled: inRange,
		pollMs: POLL_MS,
	})

	const setPage = (next: number) => {
		const search = new URLSearchParams()
		if (next > 1) search.set('page', String(next))
		setParams(search)
	}

	if (latest === undefined && chain.loading) {
		return (
			<div className="page">
				<PageSkeleton label="Loading chain state…" />
			</div>
		)
	}
	if (latest === undefined && chain.error) {
		return (
			<ErrorState
				error={chain.error}
				onRetry={chain.refresh}
				title="RPC unreachable"
			/>
		)
	}

	// Halaman melewati akhir rantai (from < 0) atau hasil kosong.
	const isEmptyPage =
		inRange && !blocks.loading && (blocks.data?.length ?? 0) === 0
	const hasMore = (blocks.data?.length ?? 0) === PAGE_SIZE
	const first = from ?? 0
	const last = first - (blocks.data?.length ?? 0) + 1

	return (
		<div className="page">
			<div className="page-head">
				<div>
					<h1>Blocks</h1>
					<p className="muted">
						{inRange && blocks.data && blocks.data.length > 0 ? (
							<>
								Heights #{formatNumber(first)} – #{formatNumber(last)} · tip #
								{formatNumber(latest!)}
							</>
						) : (
							<>Tip #{formatNumber(latest ?? 0)}</>
						)}
					</p>
				</div>
				<div className="pager">
					<button
						type="button"
						className="btn"
						disabled={page <= 1}
						onClick={() => setPage(page - 1)}
					>
						← Newer
					</button>
					<span className="pager-page">Page {formatNumber(page)}</span>
					<button
						type="button"
						className="btn"
						disabled={!hasMore || isEmptyPage}
						onClick={() => setPage(page + 1)}
					>
						Older →
					</button>
				</div>
			</div>

			<section
				className="panel table-panel"
				aria-labelledby="block-records-title"
			>
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Blockchain</p>
						<h2 id="block-records-title">Block Records</h2>
					</div>
					<span className="panel-meta">
						{formatNumber(blocks.data?.length ?? 0)} blocks
					</span>
				</div>
				<div className="panel-body table-panel-body">
					{!inRange ? (
						<EmptyState
							title="No older blocks"
							hint="This page is past the genesis block."
							action={
								<button
									type="button"
									className="btn btn-primary"
									onClick={() => setPage(1)}
								>
									Go to latest
								</button>
							}
						/>
					) : blocks.loading && !blocks.data ? (
						<div className="state-block" role="status" aria-live="polite">
							<span className="sr-only">Loading blocks…</span>
							<SkeletonTable rows={8} cols={6} />
						</div>
					) : blocks.error && !blocks.data ? (
						<ErrorState error={blocks.error} onRetry={blocks.refresh} />
					) : isEmptyPage ? (
						<EmptyState
							title="No blocks on this page"
							hint="The chain may have restarted, or this page is beyond the tip."
							action={
								<Link className="btn btn-primary" to="/blocks">
									Go to latest
								</Link>
							}
						/>
					) : (
						<>
							<BlockTable
								blocks={blocks.data ?? []}
								highlightNew={page === 1}
							/>
						</>
					)}
				</div>
			</section>
		</div>
	)
}
