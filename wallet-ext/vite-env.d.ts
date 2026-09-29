/// <reference types="vite/client" />

/**
 * Env build-time wallet-ext.
 * Nilai di-bake oleh Vite saat build. Untuk extension, endpoint RPC default
 * diambil dari chrome.storage (runtime override) lalu jatuh ke env ini.
 */
interface ImportMetaEnv {
	/** Endpoint JSON-RPC NexChain default (harus http/https). */
	readonly VITE_RPC_URL?: string
	/** Base URL explorer untuk link transaction. */
	readonly VITE_EXPLORER_URL?: string
}
