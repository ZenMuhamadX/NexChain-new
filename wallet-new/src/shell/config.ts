import { setRpcUrl } from 'src/client/rpc-client/lib/rpcClient'
import { setRpcCredentials } from '../rpc'

const STORAGE_KEY = 'wallet-new.rpc'

export interface RpcConfig {
	url: string
	user: string
	password: string
}

export const DEFAULT_RPC_CONFIG: RpcConfig = {
	url: 'http://localhost:8000/rpc',
	user: '',
	password: '',
}

const readString = (value: unknown): string | undefined =>
	typeof value === 'string' ? value : undefined

export const loadRpcConfig = (): RpcConfig => {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return DEFAULT_RPC_CONFIG
		const parsed = JSON.parse(raw) as Partial<RpcConfig>
		return {
			url: readString(parsed.url) ?? DEFAULT_RPC_CONFIG.url,
			user: readString(parsed.user) ?? '',
			password: readString(parsed.password) ?? '',
		}
	} catch {
		return DEFAULT_RPC_CONFIG
	}
}

/** Apply to the canonical client before the first RPC request. */
export const applyRpcConfig = (config: RpcConfig): void => {
	setRpcUrl(config.url)
	setRpcCredentials(config.user, config.password)
}

export const saveRpcConfig = (config: RpcConfig): void => {
	applyRpcConfig(config)
	localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

interface PermissionsApi {
	contains: (query: { origins: string[] }) => Promise<boolean>
	request: (query: { origins: string[] }) => Promise<boolean>
}

/**
 * Request origin access from the Save button. Without this, MV3 host
 * permissions reject a custom URL even when `setRpcUrl` accepts it.
 */
export const ensureRpcOrigin = async (url: string): Promise<boolean> => {
	const permissions = (
		globalThis as unknown as { chrome?: { permissions?: PermissionsApi } }
	).chrome?.permissions
	if (!permissions) return true
	const origin = `${new URL(url).origin}/*`
	if (await permissions.contains({ origins: [origin] })) return true
	return permissions.request({ origins: [origin] })
}
