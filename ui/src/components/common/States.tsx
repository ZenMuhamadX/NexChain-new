import type { ReactNode } from 'react'
import { nexchainRpcUrl } from '../../config/env'
export function LoadingState({ label = 'Loading…' }: { label?: string }) { return <div className="state loading">{label}</div> }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="state error"><strong>Unable to connect to NexChain RPC.</strong><p>{message}</p><code>{nexchainRpcUrl}</code>{retry && <button onClick={() => void retry()}>Retry</button>}</div> }
export function EmptyState({ label }: { label: ReactNode }) { return <div className="state">{label}</div> }
