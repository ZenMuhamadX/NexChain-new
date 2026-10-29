import { createContext, useContext } from 'react'
import { rpc } from '../api/methods'
import type { BlockState, PeerSnapshot, SyncStatus } from '../api/types'
import { useAsync } from './useAsync'

export interface ChainInfo {
	state: BlockState | undefined
	chainId: number | undefined
	/** Fase sinkronisasi P2P; `undefined` bila node tidak menyediakannya. */
	sync: SyncStatus | undefined
	/** Snapshot peer; `undefined` bila P2P mati atau method tidak ada. */
	peers: PeerSnapshot | undefined
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
 *
 * Sejak indikator status disatukan di header, polling yang sama juga
 * mengambil `nex_getSyncStatus` + `nex_getPeerInfo`. Keduanya **tidak boleh
 * menjatuhkan** halaman: kegagalannya di-`catch` jadi `undefined`, dan UI
 * hanya kehilangan detail — bukan seluruh status.
 */
export function useChainState(pollMs = 5000): ChainInfo {
	const { data, error, loading, refresh } = useAsync(
		async () => {
			const [state, chainId, sync, peers] = await Promise.all([
				rpc.getBlockState(),
				fetchChainId(),
				rpc.getSyncStatus().catch(() => undefined),
				rpc.getPeerInfo().catch(() => undefined),
			])
			return { state, chainId, sync, peers }
		},
		[],
		{ pollMs },
	)

	return {
		state: data?.state,
		chainId: data?.chainId,
		sync: data?.sync,
		peers: data?.peers,
		error,
		loading,
		refresh,
	}
}

export const ChainContext = createContext<ChainInfo | null>(null)

export function useChain(): ChainInfo {
	const context = useContext(ChainContext)
	if (!context) {
		throw new Error('useChain must be used within a ChainContext.Provider')
	}
	return context
}
