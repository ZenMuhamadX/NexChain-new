/// <reference types="vite/client" />

/**
 * Env build-time yang dipakai wallet-ui.
 * Nilai di-bake oleh Vite saat `bun run wallet:build` — lihat `src/lib/rpcUrl.ts`
 * untuk bagaimana `VITE_RPC_URL` dipakai sebagai default endpoint RPC.
 */
interface ImportMetaEnv {
	/** Endpoint JSON-RPC NexChain (harus http/https). Kosong = ikut hostname halaman. */
	readonly VITE_RPC_URL?: string
}
