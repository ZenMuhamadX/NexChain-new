/** Layar di luar sesi terkunci (alur onboarding / unlock). */
export type Screen = 'welcome' | 'create' | 'import' | 'unlock'

/**
 * Layar utama setelah wallet terbuka.
 *
 * Kirim, Terima, dan Aktivitas BUKAN tujuan navigasi: semuanya dibuka sebagai
 * sheet di atas Beranda. Hanya Pengaturan yang layar terpisah.
 */
export type View = 'beranda' | 'pengaturan'

/** Sheet aksi yang sedang terbuka di atas layar aktif. `null` = tidak ada. */
export type WalletAction = 'kirim' | 'terima' | null
