/// <reference types="vite/client" />

/**
 * Env build-time yang dipakai paket `wallet/`.
 * Nilai di-bake oleh Vite saat `bun run wallet:build` — lihat `src/lib/rpcUrl.ts`
 * untuk bagaimana `VITE_RPC_URL` dipakai sebagai default endpoint RPC.
 */
interface ImportMetaEnv {
	/** Endpoint JSON-RPC NexChain (harus http/https). Kosong = ikut hostname halaman. */
	readonly VITE_RPC_URL?: string
	/** Base URL explorer untuk link transaction dari wallet. */
	readonly VITE_EXPLORER_URL?: string
	/**
	 * Backend vault yang dipilih tanpa injeksi shell. Nilai yang dikenal:
	 * `memory` (shell dev) dan `idb`. Shell desktop TIDAK memakai env ini —
	 * ia menyuntikkan `installVaultKV()` dengan backend berkas (fail-closed).
	 * Lihat `src/lib/vaultStore.ts`.
	 */
	readonly VITE_VAULT_BACKEND?: 'idb' | 'memory' | 'file'
}
