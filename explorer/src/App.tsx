import { Route, Routes } from 'react-router-dom'
import { ExplorerLayout } from './components/layout/ExplorerLayout'
import { ChainContext, useChainState } from './hooks/useChainState'
import { AddressPage } from './pages/AddressPage'
import { BlockDetailPage } from './pages/BlockDetailPage'
import { BlocksPage } from './pages/BlocksPage'
import { DashboardPage } from './pages/DashboardPage'
import { MempoolPage } from './pages/MempoolPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SearchResultsPage } from './pages/SearchResultsPage'
import { TxDetailPage } from './pages/TxDetailPage'

export function App() {
	// SATU instance chain state dipakai seluruh halaman (satu polling saja).
	const chain = useChainState(5000)

	return (
		<ChainContext.Provider value={chain}>
			<Routes>
				<Route element={<ExplorerLayout />}>
					<Route index element={<DashboardPage />} />
					<Route path="blocks" element={<BlocksPage />} />
					<Route path="mempool" element={<MempoolPage />} />
					<Route path="block/:id" element={<BlockDetailPage />} />
					<Route path="tx/:hash" element={<TxDetailPage />} />
					<Route path="address/:address" element={<AddressPage />} />
					<Route path="search/:query" element={<SearchResultsPage />} />
					<Route path="*" element={<NotFoundPage />} />
				</Route>
			</Routes>
		</ChainContext.Provider>
	)
}
