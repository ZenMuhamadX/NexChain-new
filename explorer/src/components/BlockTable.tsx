import { Link } from 'react-router-dom'
import type { blockSummary } from '../api/types'
import {
	formatDateTime,
	formatNxc,
	formatNumber,
	formatSize,
	timeAgo,
	truncateMiddle,
} from '../lib/format'

export function BlockTable({ blocks }: { blocks: blockSummary[] }) {
	return (
		<div className="table-wrap">
			<table className="table">
				<thead>
					<tr>
						<th>Height</th>
						<th>Hash</th>
						<th>Age</th>
						<th className="num">Txs</th>
						<th className="num">Size</th>
						<th className="num">Reward</th>
					</tr>
				</thead>
				<tbody>
					{blocks.map((block) => (
						<tr key={block.hash}>
							<td>
								<Link className="link mono" to={`/block/${block.height}`}>
									#{formatNumber(block.height)}
								</Link>
							</td>
							<td>
								<Link
									className="link mono"
									to={`/block/${block.hash}`}
									title={block.hash}
								>
									{truncateMiddle(block.hash)}
								</Link>
							</td>
							<td title={formatDateTime(block.timestamp)}>
								{timeAgo(block.timestamp)}
							</td>
							<td className="num">{formatNumber(block.txCount)}</td>
							<td className="num">{formatSize(block.size)}</td>
							<td className="num" title="Total reward (coinbase)">
								{formatNxc(block.totalReward, 4)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
