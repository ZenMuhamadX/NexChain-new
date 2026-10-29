import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rpc } from '../api/methods'
import { tryHexText } from '../api/decoder'
import { isNotFound } from '../api/rpcClient'
import type { HistoryEntry } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CopyButton } from '../components/common/CopyButton'
import { HashValue } from '../components/common/HashValue'
import { RawJson } from '../components/common/RawJson'
import { PageSkeleton } from '../components/common/Skeleton'
import { EmptyState, ErrorState } from '../components/common/States'
import { Unit } from '../components/common/Unit'
import { useAsync } from '../hooks/useAsync'
import { useChain } from '../hooks/useChainState'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { hasSignature, isCoinbaseRecord } from '../lib/tx'
import {
	formatDateTime,
	formatNxcExact,
	formatNumber,
	timeAgo,
	truncateMiddle,
} from '../lib/format'

export function TxDetailPage() {
	const { hash = '' } = useParams()
	const chain = useChain()
	/** Overview default RINGKAS: 2 pasang (Type/Status, Amount/Timestamp). */
	const [expanded, setExpanded] = useState(false)
	const {
		data: tx,
		error,
		loading,
		refresh,
	} = useAsync<HistoryEntry | undefined>(
		async () => await rpc.getTransactionByHash(hash),
		[hash],
	)

	useDocumentTitle(`Transaction ${truncateMiddle(hash, 12, 10)}`)

	if (loading && !tx) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Transaction' }]} />
				<PageSkeleton label="Loading transaction…" />
			</div>
		)
	}

	if (error && isNotFound(error)) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Transaction' }]} />
				<EmptyState
					titleAs="h1"
					title="Transaction not found"
					hint={
						<>
							No transaction matches <code>{hash}</code>. Mempool transactions
							are only visible after they are saved to history.
						</>
					}
					action={
						<Link className="btn btn-primary" to="/mempool">
							View pending transactions
						</Link>
					}
				/>
			</div>
		)
	}
	if (error && !tx) {
		return <ErrorState error={error} onRetry={refresh} />
	}
	if (!tx) {
		return (
			<div className="page">
				<Breadcrumbs items={[{ label: 'Transaction' }]} />
				<EmptyState
					titleAs="h1"
					title="Transaction not found"
					hint={
						<>
							No transaction matches <code>{hash}</code>.
						</>
					}
					action={
						<Link className="btn btn-primary" to="/">
							Back to dashboard
						</Link>
					}
				/>
			</div>
		)
	}

	const meta = tx.metadata
	const coinbase = isCoinbaseRecord(tx)
	const signed = hasSignature(tx)
	const tip = chain.state?.currentBlockHeight
	const confirmations =
		meta && tip !== undefined
			? Math.max(tip - meta.blockHeight + 1, 1)
			: undefined
	const txHash = tx.txHash ?? hash
	const status = meta ? 'confirmed' : 'pending'
	// Hadiah blok bukan transaksi: tidak ditandatangani, nonce 0, fee 0.
	// Menampilkannya sebagai "transfer dari COINBASE" adalah kebohongan
	// struktural — sentinel itu hanya label riwayat.
	const kindLabel = coinbase ? 'Block reward' : 'Transfer'
	const kindBadge = coinbase ? 'badge-contract' : `badge-${status}`

	return (
		<div className="page detail-page">
			<Breadcrumbs
				items={[
					...(meta ? [{ label: 'Blocks', to: '/blocks' }] : []),
					...(meta
						? [
								{
									label: `#${formatNumber(meta.blockHeight)}`,
									to: `/block/${meta.blockHeight}`,
								},
							]
						: []),
					{ label: `Tx ${truncateMiddle(txHash, 8, 6)}` },
				]}
			/>

			<section className="detail-header" aria-labelledby="tx-title">
				<div className="detail-heading">
					<p className="detail-eyebrow">
						{coinbase ? 'Coinbase record' : 'Transaction'}
					</p>
					<h1 id="tx-title">
						{kindLabel}
						<span className={`badge ${kindBadge}`}>
							{coinbase ? 'protocol' : status}
						</span>
					</h1>
					<p>
						{meta
							? `${formatDateTime(meta.blockTimestamp)} · ${timeAgo(meta.blockTimestamp)}`
							: 'Not yet included in a block'}
						{confirmations !== undefined
							? ` · ${formatNumber(confirmations)} confirmations`
							: ''}
					</p>
				</div>
				{/* Hash ditampilkan PENUH (67 karakter: `TxC` + 64 hex) + tombol
				    copy. `.detail-hash-wide` melepas `max-width: 28rem` bawaan
				    `.detail-hash` yang dulu memaksa hash dipotong. */}
				<div className="detail-hash detail-hash-wide">
					<span>{coinbase ? 'Reward id' : 'Transaction hash'}</span>
					<div className="hash-copy-row">
						<code title={txHash}>{txHash}</code>
						<CopyButton
							value={txHash}
							label={coinbase ? 'Copy reward id' : 'Copy transaction hash'}
						/>
					</div>
				</div>
			</section>

			<section className="panel" aria-labelledby="tx-overview-title">
				<div className="panel-head">
					<div>
						<p className="panel-eyebrow">Transaction data</p>
						<h2 id="tx-overview-title">Overview</h2>
					</div>
					<div className="panel-head-actions">
						<span className="panel-meta">
							{meta ? `Block #${formatNumber(meta.blockHeight)}` : 'Pending'}
						</span>
						<button
							type="button"
							className="panel-toggle"
							aria-expanded={expanded}
							aria-controls="tx-overview"
							onClick={() => setExpanded((value) => !value)}
						>
							{expanded ? 'Show less' : 'Show all details'}
						</button>
					</div>
				</div>
				<div className="panel-body">
					{/* 8 field = 4 pasang (genap), semua baris berpasangan:
					    - "Transaction hash" dihapus (sudah penuh + copy di header).
					    - "Confirmations" dihapus (sudah menempel di baris Status).
					    - "Amount (exact)" dihapus; baris Amount memakai presisi penuh.
					    - "Block" + "Source block" digabung (objeknya sama).
					    Signature v/r/s (64 karakter) tidak muat di kolom separuh, jadi
					    jadi blok sendiri selebar kartu; From -> To juga blok sendiri
					    dengan panah. Keduanya hanya tampil saat expand. */}
					<dl className="detail-grid detail-grid-tidy" id="tx-overview">
						<div className="detail-row">
							<dt>Type</dt>
							<dd>
								{coinbase ? 'Block reward (coinbase)' : 'Signed transfer'}
							</dd>
						</div>
						<div className="detail-row">
							<dt>Status</dt>
							<dd>
								<span className={`badge badge-${status}`}>{status}</span>
								<span className="muted">
									{confirmations !== undefined
										? `${formatNumber(confirmations)} confirmations`
										: 'not yet mined'}
								</span>
							</dd>
						</div>
						<div className="detail-row">
							<dt>{coinbase ? 'Reward amount' : 'Amount'}</dt>
							<dd className="mono">{formatNxcExact(tx.amount)} NXC</dd>
						</div>
						<div className="detail-row">
							<dt>Timestamp</dt>
							<dd>
								{meta
									? formatDateTime(meta.blockTimestamp)
									: 'Not yet included in a block'}
							</dd>
						</div>
						{expanded ? (
							<>
								<div className="detail-row">
									<dt>Block</dt>
									<dd>
										{meta ? (
											<>
												<Link to={`/block/${meta.blockHeight}`}>
													#{formatNumber(meta.blockHeight)}
												</Link>
												<HashValue
													value={meta.blockHash}
													link={`/block/${meta.blockHash}`}
													head={14}
													tail={12}
												/>
											</>
										) : (
											'Pending'
										)}
									</dd>
								</div>
								<div className="detail-row">
									<dt>Transaction fee</dt>
									<dd>
										{coinbase ? (
											<span
												className="muted"
												title="Block rewards pay no fee"
											>
												— (protocol credit)
											</span>
										) : (
											<Unit>{formatNumber(tx.fee)}</Unit>
										)}
									</dd>
								</div>
								<div className="detail-row">
									<dt>Nonce</dt>
									<dd>
										{coinbase ? (
											<span
												className="muted"
												title="Block rewards have no nonce"
											>
												—
											</span>
										) : (
											formatNumber(tx.nonce)
										)}
									</dd>
								</div>
								<div className="detail-row">
									<dt>Merkle root</dt>
									<dd title="Root of the source block's merkle tree — this transaction is one of its leaves.">
										{meta ? (
											<HashValue
												value={meta.merkleRoot}
												head={14}
												tail={12}
											/>
										) : (
											'—'
										)}
									</dd>
								</div>
							</>
						) : null}
					</dl>
					{expanded ? (
						<div className="tx-signature">
							{signed ? (
								<>
									<p className="panel-eyebrow">Signature</p>
									<dl className="tx-signature-grid">
										<div>
											<dt>v</dt>
											<dd className="mono">{tx.sign.v}</dd>
										</div>
										<div>
											<dt>r</dt>
											<dd className="mono" title={tx.sign.r}>
												{tx.sign.r}
											</dd>
										</div>
										<div>
											<dt>s</dt>
											<dd className="mono" title={tx.sign.s}>
												{tx.sign.s}
											</dd>
										</div>
									</dl>
								</>
							) : (
								<p className="muted pad-sm">
									No signature: this record is a protocol credit, not a
									signed transaction.
								</p>
							)}
						</div>
					) : null}
					{/* From -> To SELALU tampil (ringkas maupun expand): ini inti
					    dari sebuah transaksi, bukan detail tambahan. */}
					<div className="tx-transfer">
						<p className="panel-eyebrow">Transfer</p>
						<div className="transfer-flow">
							<div className="transfer-party">
								<span>{coinbase ? 'Source' : 'From'}</span>
								{coinbase ? (
									<div className="mono muted">
										Coinbase (block reward)
									</div>
								) : (
									<Link className="mono" to={`/address/${tx.from ?? ''}`}>
										{tx.from ?? '—'}
									</Link>
								)}
							</div>
							<div className="transfer-arrow" aria-hidden="true">
								→
							</div>
							<div className="transfer-party">
								<span>To</span>
								<Link className="mono" to={`/address/${tx.receiver}`}>
									{tx.receiver}
								</Link>
							</div>
						</div>
					</div>
				</div>
			</section>

			{tx.data ? (
				<section className="panel" aria-labelledby="tx-data-title">
					<div className="panel-head">
						<h2 id="tx-data-title">Data</h2>
					</div>
					<div className="panel-body">
						<RawInput hex={tx.data} />
					</div>
				</section>
			) : null}

			{/* Signature (v/r/s) sudah pindah ke grid Overview (mode expand), jadi
			    blok `<details>` terpisah di sini tidak diperlukan lagi. */}

			<RawJson data={tx} summary="Raw transaction JSON" />
		</div>
	)
}

function RawInput({ hex }: { hex: string }) {
	const text = tryHexText(hex)
	return <p className="tx-message mono">{text ?? hex}</p>
}
