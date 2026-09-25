import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { blockSummary } from '../api/types'
import { useTimeDisplay } from '../hooks/useTimeDisplay'
import {
	formatDateTime,
	formatNxc,
	formatNumber,
	formatSize,
	timeAgo,
	truncateMiddle,
} from '../lib/format'

/**
 * @param highlightNew tandai baris yang baru saja menjadi tip terbaru
 * (hanya relevan di halaman yang polling; di halaman paginasi blok lama
 * hal itu akan menyesatkan).
 */
export function BlockTable({
	blocks,
	highlightNew = false,
}: {
	blocks: blockSummary[]
	highlightNew?: boolean
}) {
	// --- deteksi blok baru: flash baris supaya mata pembaca tidak kehilangan tempat ---
	const previousTop = useRef<string | undefined>(undefined)
	const [freshTop, setFreshTop] = useState<string | undefined>(undefined)
	const { mode: timeMode, toggle: toggleTimeMode } = useTimeDisplay()

	useEffect(() => {
		if (!highlightNew) return
		const top = blocks[0]?.hash
		if (top === undefined) return
		if (previousTop.current !== undefined && previousTop.current !== top) {
			setFreshTop(top)
		}
		previousTop.current = top
	}, [blocks, highlightNew])

	useEffect(() => {
		if (!freshTop) return undefined
		const timer = setTimeout(() => setFreshTop(undefined), 1600)
		return () => clearTimeout(timer)
	}, [freshTop])

	return (
		<div className="table-wrap">
			<table className="table table-responsive">
				<caption className="sr-only">
					Blocks — height, hash, age, transactions, size and reward
				</caption>
				<thead>
					<tr>
						<th scope="col">Height</th>
						<th scope="col">Hash</th>
						<th scope="col" aria-sort="none">
							<button
								type="button"
								className="table-time-toggle"
								onClick={toggleTimeMode}
								aria-label={`Show ${timeMode === 'age' ? 'date and time' : 'block age'}`}
								title="Toggle age and date/time"
							>
								{timeMode === 'age' ? 'Age' : 'Date Time'}
							</button>
						</th>
						<th scope="col" className="num">
							Txs
						</th>
						<th scope="col" className="num">
							Size
						</th>
						<th scope="col" className="num">
							Reward
						</th>
					</tr>
				</thead>
				<tbody>
					{blocks.map((block) => (
						<tr
							key={block.hash}
							className={freshTop === block.hash ? 'is-new' : undefined}
						>
							<td data-label="Height">
								<Link className="link mono" to={`/block/${block.height}`}>
									#{formatNumber(block.height)}
								</Link>
							</td>
							<td data-label="Hash">
								<Link
									className="link mono"
									to={`/block/${block.hash}`}
									title={block.hash}
								>
									{truncateMiddle(block.hash)}
								</Link>
							</td>
							<td
								data-label={timeMode === 'age' ? 'Age' : 'Date Time'}
								title={formatDateTime(block.timestamp)}
							>
								{timeMode === 'age'
									? timeAgo(block.timestamp)
									: formatDateTime(block.timestamp)}
							</td>
							<td data-label="Txs" className="num">
								{formatNumber(block.txCount)}
							</td>
							<td data-label="Size" className="num">
								{formatSize(block.size)}
							</td>
							<td
								data-label="Reward"
								className="num"
								title="Total reward (coinbase)"
							>
								{formatNxc(block.totalReward, 4)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="scroll-hint">Scroll sideways to see every column →</p>
		</div>
	)
}
