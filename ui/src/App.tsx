import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ExplorerLayout } from './components/layout/ExplorerLayout'
import { useChainState } from './hooks/useChainState'
import { DashboardPage } from './pages/DashboardPage'
import { BlocksPage } from './pages/BlocksPage'
import { BlockDetailPage } from './pages/BlockDetailPage'
export function App() { const chain = useChainState(); return <BrowserRouter><Routes><Route element={<ExplorerLayout chain={chain}/>}><Route index element={<DashboardPage/>}/><Route path="blocks" element={<BlocksPage/>}/><Route path="block/:height" element={<BlockDetailPage mode="height"/>}/><Route path="block/hash/:hash" element={<BlockDetailPage mode="hash"/>}/></Route></Routes></BrowserRouter> }
