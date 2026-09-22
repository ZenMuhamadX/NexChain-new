import { useCallback, useEffect, useRef, useState } from 'react'
import { nexchainRpc } from '../api/nexchain/rpcMethods'
import { RpcClientError } from '../api/nexchain/rpcClient'
import type { Block } from '../api/nexchain/rpcTypes'

export type RpcStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
export interface ChainState { status: RpcStatus; chainId?: number; currentBlock?: Block; message: string; refresh: () => Promise<void> }
const intervalMs = 3_000
export function useChainState(): ChainState {
 const [status, setStatus] = useState<RpcStatus>('connecting'); const [chainId, setChainId] = useState<number>(); const [currentBlock, setCurrentBlock] = useState<Block>(); const [message, setMessage] = useState('Connecting to the NexChain node…'); const busy = useRef(false)
 const refresh = useCallback(async () => { if (busy.current) return; busy.current = true; setStatus(previous => previous === 'connected' ? previous : 'connecting'); try { const [id, block] = await Promise.all([nexchainRpc.getChainId(), nexchainRpc.getCurrentBlock()]); setChainId(id); setCurrentBlock(block); setStatus('connected'); setMessage('Live data received from the configured RPC endpoint.') } catch (error) { setStatus(error instanceof RpcClientError && error.kind === 'network' ? 'disconnected' : 'error'); setMessage(error instanceof Error ? error.message : 'Unable to connect to NexChain RPC.') } finally { busy.current = false } }, [])
 useEffect(() => { void refresh(); const timer = window.setInterval(() => { void refresh() }, intervalMs); return () => window.clearInterval(timer) }, [refresh])
 return { status, chainId, currentBlock, message, refresh }
}
