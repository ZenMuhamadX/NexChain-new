import { createContext, useContext } from 'react'
import { rpc } from '../api/methods'
import type { BlockState } from '../api/types'
import { useAsync } from './useAsync'

export interface ChainInfo {
	state: BlockState | undefined
	chainId: number | undefined
	error: unknown
	loading: boolean
	refresh: () => void
}

/** Chain ID statis — cukup diambil sekali per sesi. */
let cachedChainId: number | undefined
const fetchChainId = async (): Promise<number | undefined> => {
	if (cachedChainId === undefined) {
		cachedChainId = await rpc.getChainId()
	}
	return cachedChainId
}

/**
 * Block state global (height, hash, reward, dst) dengan auto-refresh.
 * Dipakai lewat ChainContext supaya SELURUH halaman berbagi SATU polling,
 * bukan masing-masing bikin request sendiri.
 */
export function useChainState(pollMs = 5000): ChainInfo {
	const { data, error, loading, refresh } = useAsync(async () => {
		const [state, chainId] = await Promise.all([
			rpc.getBlockState(),
			fetchChainId(),
		])
		return { state, chainId }
	}, [], { pollMs })

	return {
		state: data?.state,
		chainId: data?.chainId,
		error,
		loading,
		refresh,
	}
}

export const ChainContext = createContext<ChainInfo | null>(null)

export function useChain(): ChainInfo {
	const context = useContext(ChainContext)
	if (!context) {
		throw new Error('useChain harus dipakai di dalam ChainContext.Provider')
	}
	return context
}
