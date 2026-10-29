/// <reference types="vite/client" />
/**
 * Deklarasi `virtual:pwa-register` (+ `useRegisterSW`, dst.).
 *
 * Hanya target `web` yang memakai modul virtual ini, tetapi referensinya
 * ditaruh global supaya `tsc` mengenal tipenya tanpa perlu konfigurasi khusus
 * per target. Di dev/desktop modul ini tidak pernah diimpor.
 */
/// <reference types="vite-plugin-pwa/client" />

/**
 * Versi `wallet/package.json` yang di-bake `vite.config.ts` saat build.
 * Di dev/preview nilainya juga terisi (define berlaku untuk semua target).
 */
declare const __APP_VERSION__: string

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
