import { Link } from 'react-router-dom'
import { EmptyState } from '../components/common/States'

export function NotFoundPage() {
	return (
		<div className="page">
			<EmptyState
				title="404 — Page not found"
				hint="The route you requested does not exist."
				action={
					<Link className="btn btn-primary" to="/">
						Back to dashboard
					</Link>
				}
			/>
		</div>
	)
}
