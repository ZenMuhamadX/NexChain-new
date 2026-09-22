import { useOutletContext } from 'react-router-dom'
import type { ChainState } from '../hooks/useChainState'
import { useRecentBlocks } from '../hooks/useRecentBlocks'
import { BlockTable } from '../components/blocks/BlockTable'
import { ErrorState, LoadingState } from '../components/common/States'
export function BlocksPage() { const chain = useOutletContext<ChainState>(); const recent = useRecentBlocks(chain.currentBlock?.block.height, 10); return <section className="content"><div className="page-heading"><div><p className="eyebrow">BLOCK EXPLORER</p><h1>Blocks</h1><p>Latest blocks retrieved directly from NexChain RPC.</p></div><button disabled={chain.status === 'connecting'} onClick={() => void chain.refresh()}>Refresh</button></div>{chain.status !== 'connected' && !chain.currentBlock ? <ErrorState message={chain.message} retry={chain.refresh}/> : recent.loading && !recent.blocks.length ? <LoadingState label="Loading blocks…"/> : recent.error ? <ErrorState message={recent.error}/> : <BlockTable blocks={recent.blocks}/>}</section> }
