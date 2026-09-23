import { CopyButton } from './CopyButton'

/** Inspector JSON lipat — untuk data mentah apa pun. */
export function RawJson({
	data,
	summary = 'Raw JSON',
}: {
	data: unknown
	summary?: string
}) {
	return (
		<details className="raw-json">
			<summary>
				{summary}
				<span className="raw-json-action">
					<CopyButton
						value={JSON.stringify(data, null, 2)}
						label="Copy JSON"
					/>
				</span>
			</summary>
			<pre className="raw-json-body">
				{JSON.stringify(data, null, 2)}
			</pre>
		</details>
	)
}
