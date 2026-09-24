import { Link } from 'react-router-dom'
import { EmptyState } from '../components/common/States'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export function NotFoundPage() {
	useDocumentTitle('Page not found')

	return (
		<div className="page">
			<EmptyState
				titleAs="h1"
				title="404 — Page not found"
				hint="The route you requested does not exist."
				action={
					<div className="empty-actions">
						<Link className="btn btn-primary" to="/">
							Back to dashboard
						</Link>
						<Link className="btn" to="/blocks">
							Browse blocks
						</Link>
						<Link className="btn" to="/mempool">
							View mempool
						</Link>
					</div>
				}
			/>
		</div>
	)
}
