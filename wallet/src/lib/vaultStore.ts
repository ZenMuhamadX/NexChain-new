import type { WalletKV } from 'src/client/wallet/kv'
import { createMemoryKV } from 'src/client/wallet/kv'
import { createIdbKV } from 'src/client/wallet/idbKv'

/**
 * TITIK SUNTIK 1 — penyimpanan vault.
 *
 * Sembilan layar wallet tidak pernah tahu vault disimpan di mana. Yang mereka
 * pakai adalah `getVault()` dari `./vault`, dan itu memanggil `getVaultKV()`
 * di sini. Dengan begitu SATU basis kode bisa melayani beberapa target:
 *
 *   - `idb`    → browser / preview (IndexedDB, `nex-wallet`)
 *   - `memory` → shell developer, tanpa berkas sama sekali
 *   - `file`   → shell desktop (Shell memanggil `installVaultKV()` lebih dulu)
 *
 * Backend `file` TIDAK diimplementasikan di sini karena ia butuh jembatan
 * ke proses desktop (IPC/preload) yang hanya ada di shell. Shell desktop
 * memanggil `installVaultKV()` dengan adaptor-nya sendiri SEBELUM render
 * pertama — lihat `shells/desktop/src/`. Shell web melakukan hal yang sama
 * untuk IndexedDB (`shells/web/main.tsx`), dan shell dev untuk memori
 * (`shells/dev/main.tsx`): injeksi eksplisit mencegah `VITE_VAULT_BACKEND`
 * yang tertinggal mengubah backend tanpa terlihat.
 *
 * Urutan pemilihan: yang disuntikkan shell selalu menang atas deteksi
 * otomatis. Deteksi otomatis hanya berlaku di browser.
 */

export type VaultBackendName = 'idb' | 'memory' | 'file'

/** Dipilih eksplisit oleh shell (desktop/web/dev) atau lewat `VITE_VAULT_BACKEND`. */
let injected: WalletKV | undefined

/**
 * Nama backend yang disuntikkan shell.
 *
 * Shell boleh menyuntikkan backend APA PUN (desktop: berkas, web: IndexedDB,
 * dev: memori), jadi nama tidak boleh ditebak dari "ada injeksi". Tanpa ini
 * `vaultBackendName()` akan melaporkan `file` untuk PWA.
 */
let injectedName: VaultBackendName = 'file'

/**
 * Pasang backend vault dari shell. WAJIB dipanggil sebelum `getVault()` /
 * sebelum React dirender, karena `getVault()` menyimpan promise singleton.
 *
 * `name` hanya untuk pelaporan/debugging; default `file` mempertahankan
 * perilaku shell desktop.
 */
export const installVaultKV = (
	kv: WalletKV,
	name: VaultBackendName = 'file',
): void => {
	injected = kv
	injectedName = name
}

/** Buang backend yang disuntikkan (dipakai tes / hot-reload). */
export const resetVaultKV = (): void => {
	injected = undefined
	injectedName = 'file'
	cached = undefined
}

/**
 * Backend dari env build (`VITE_VAULT_BACKEND`), bila valid.
 *
 * Dipakai shell developer: `VITE_VAULT_BACKEND=memory` membuat wallet bisa
 * dijalankan tanpa IndexedDB dan tanpa berkas — cukup untuk mengerjakan
 * tampilan dan alur.
 */
const envBackend = (): VaultBackendName | undefined => {
	const raw = import.meta.env.VITE_VAULT_BACKEND
	if (raw === 'idb' || raw === 'memory' || raw === 'file') return raw
	return undefined
}

let cached: Promise<WalletKV> | undefined

/**
 * Backend yang sedang aktif. Hanya untuk ditampilkan di UI/debugging —
 * jangan dicabangkan di layar.
 */
export const vaultBackendName = (): VaultBackendName => {
	if (injected) return injectedName
	return envBackend() ?? 'idb'
}

export const getVaultKV = (): Promise<WalletKV> => {
	if (injected) return Promise.resolve(injected)

	if (cached) return cached

	const backend = envBackend() ?? 'idb'

	if (backend === 'memory') {
		// Sinkron, tapi tetap dibungkus Promise agar kontraknya seragam.
		cached = Promise.resolve(createMemoryKV())
		return cached
	}

	if (backend === 'file') {
		// `file` tanpa injeksi berarti shell lupa memanggil `installVaultKV`.
		// Lebih baik gagal jelas daripada diam-diam jatuh ke IndexedDB dan
		// membuat vault "hilang" dari sudut pandang pengguna.
		return Promise.reject(
			new Error(
				'Backend vault "file" dipilih tetapi belum disuntikkan shell. ' +
					'Panggil installVaultKV() sebelum render.',
			),
		)
	}

	cached = createIdbKV()
	return cached
}
