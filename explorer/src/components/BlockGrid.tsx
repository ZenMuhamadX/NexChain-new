import { Link } from 'react-router-dom'
import type { blockSummary } from '../api/types'
import { formatNumber, timeAgo } from '../lib/format'

/**
 * Visualisasi blok — heatmap densitas transaksi 40 blok terakhir.
 *
 * Sebelumnya dashboard sepenuhnya berupa angka statis dalam kotak: user
 * harus membaca satu per satu untuk tahu blok mana yang ramai. Dengan ini
 * "blok mana yang penuh" terbaca sekilas dari warna, sementara angka tx
 * tetap tercetak sehingga warna tidak menjadi satu-satunya pembawa makna
 * (WCAG 1.4.1 — use of color).
 *
 * Data: `nex_getRecentBlocks` yang sudah tersedia; tidak ada endpoint baru.
 */

/**
 * 0 tx → level 0; selain itu diskalakan ke5 level.
 *
 * Penyebutnya `max(max, 5)` — bukan `max` saja. Data nyata di sini
 * txCount hanya1–4, jadi skala relatif murni akan mengunci rantai kecil
 * ke dua warna saja (1 → level 1, 4 → level 5), dan bila semua blok
 * sama-sama 1 tx seluruh grid berubah biru pekat. Dengan plafon5,
 * rantai sepi memakai skala absolut (1 tx = level1 … 5 tx = level5)
 * dan begitu ada blok padat (>5 tx) skalanya kembali relatif.
 */
const QUIET_REFERENCE = 5

function heatLevel(txCount: number, max: number): number {
	if (txCount <= 0) return 0
	const scale = Math.max(max, QUIET_REFERENCE)
	return Math.min(5, Math.max(1, Math.round((txCount / scale) * 5)))
}

export function BlockGrid({ blocks }: { blocks: blockSummary[] }) {
	if (blocks.length === 0) return null

	const max = blocks.reduce((peak, block) => Math.max(peak, block.txCount), 0)
	const latestHash = blocks[0].hash

	return (
		<>
			<div
				className="block-grid"
				role="list"
				aria-label={`Latest ${blocks.length} blocks by transaction density`}
			>
				{blocks.map((block) => {
					const level = heatLevel(block.txCount, max)
					const isLatest = block.hash === latestHash
					return (
						<div role="listitem" key={block.hash} className="block-cell-wrap">
							<Link
								to={`/block/${block.height}`}
								className={`block-cell heat-${level}${isLatest ? ' is-latest is-fresh' : ''}`}
								aria-label={`Block ${block.height}, ${block.txCount} transaction${block.txCount === 1 ? '' : 's'}, ${timeAgo(block.timestamp)}`}
							>
								<span className="block-cell-height">
									#{formatNumber(block.height)}
								</span>
								<span className="block-cell-txs">
									{formatNumber(block.txCount)}
								</span>
								<span className="block-cell-age">
									{timeAgo(block.timestamp)}
								</span>
							</Link>
						</div>
					)
				})}
			</div>

			<p className="block-grid-legend">
				<span>Block height, transactions, age</span>
				<span className="legend-scale">
					<span>fewer tx</span>
					<span className="legend-swatch heat-0" aria-hidden="true" />
					<span className="legend-swatch heat-1" aria-hidden="true" />
					<span className="legend-swatch heat-2" aria-hidden="true" />
					<span className="legend-swatch heat-3" aria-hidden="true" />
					<span className="legend-swatch heat-4" aria-hidden="true" />
					<span className="legend-swatch heat-5" aria-hidden="true" />
					<span>more tx</span>
				</span>
			</p>
		</>
	)
}
