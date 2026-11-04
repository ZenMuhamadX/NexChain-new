/** Layar di luar sesi terkunci (alur onboarding / unlock). */
export type Screen = 'welcome' | 'create' | 'import' | 'unlock'

/**
 * Layar utama setelah wallet terbuka.
 *
 * Kirim dan Terima BUKAN tujuan navigasi: keduanya dibuka sebagai sheet di
 * atas layar yang sedang aktif. Beranda, Riwayat, dan Pengaturan adalah layar
 * terpisah; Riwayat ada supaya daftar transaksi tidak memanjang di beranda.
 */
export type View = 'beranda' | 'riwayat' | 'pengaturan'

/** Sheet aksi yang sedang terbuka di atas layar aktif. `null` = tidak ada. */
export type WalletAction = 'kirim' | 'terima' | null
