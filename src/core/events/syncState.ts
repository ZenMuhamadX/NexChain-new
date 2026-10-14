/**
 * Status sinkronisasi node yang NETRAL (tanpa dependensi P2P).
 *
 * Tujuan: `src/core/` (khususnya `nex_getWork` di `consensus/work.ts`) perlu
 * tahu apakah node masih MENGEJAR rantai peer, TANPA mengimpor `src/p2p/`.
 * Impor semacam itu akan membalik arah dependensi (core menjadi tahu
 * jaringan) dan melanggar aturan lapisan — jadi core hanya MEMBACA modul kecil
 * ini, dan `src/p2p/` yang MENULISNYA.
 *
 * ## Model latch (sekali "synced", tetap "synced")
 *
 * Begitu node menyatakan dirinya sudah menyusul rantai, ia TIDAK pernah
 * kembali "syncing" selama proses hidup. Alasannya:
 *
 *   - Reorg belum didukung (lihat `src/p2p/validation/connectBlock.ts`):
 *     blok baru selalu menempel ke tip, jadi setelah menyusul, kemajuan
 *     berikutnya datang lewat gossip push — bukan IBD lagi.
 *   - Tanpa latch, setiap blok baru yang diumumkan peer akan menyalakan
 *     kembali gerbang `nex_getWork`, sehingga miner terputus-putus.
 *
 * ## Default AMAN
 *
 * Fase awal `idle` → `isSyncing()` bernilai `false`. Node tanpa P2P (atau node
 * tunggal dev) berjalan persis seperti sebelumnya: mining tidak pernah ditahan
 * hanya karena modul ini ada.
 *
 * Modul ini murni (tanpa I/O, tanpa timer) sehingga aman dipaketkan ke browser.
 */

/** Fase sinkronisasi. `idle` = P2P tidak aktif / belum ada kabar. */
export type SyncPhase = 'idle' | 'syncing' | 'assumed' | 'synced'

/** Potret status sync untuk konsumsi RPC/diagnostik. */
export interface SyncStatus {
	phase: SyncPhase
	/** Pintasan `phase === 'syncing'` agar pemanggil tidak perlu memetakan. */
	syncing: boolean
	/** Tinggi rantai lokal terakhir yang dilaporkan P2P (0 bila belum). */
	localHeight: number
	/**
	 * Tinggi peer terdepan yang diketahui (0 bila belum). Ini HANYA petunjuk —
	 * keputusan "sudah menyusul" tidak pernah bersandar pada angka ini.
	 */
	targetHeight: number
	/** Epoch ms perubahan terakhir. */
	updatedAt: number
}

interface SyncMeta {
	localHeight?: number | undefined
	targetHeight?: number | undefined
}

let phase: SyncPhase = 'idle'
let localHeight = 0
let targetHeight = 0
let updatedAt = 0

const applyMeta = (meta?: SyncMeta): void => {
	if (meta?.localHeight !== undefined && Number.isFinite(meta.localHeight)) {
		localHeight = meta.localHeight
	}
	if (meta?.targetHeight !== undefined && Number.isFinite(meta.targetHeight)) {
		targetHeight = meta.targetHeight
	}
}

/**
 * Apakah node sedang mengejar rantai peer. Dipakai `nex_getWork` untuk
 * menahan mining. `false` bila P2P mati / belum pernah menandai syncing.
 */
export const isSyncing = (): boolean => phase === 'syncing'

/** Potret status sync (salinan, tidak bisa memutasi state internal). */
export const getSyncStatus = (): SyncStatus => ({
	phase,
	syncing: phase === 'syncing',
	localHeight,
	targetHeight,
	updatedAt,
})

/**
 * Tandai node mulai/masih mengejar rantai peer.
 *
 * LATCH: bila fase sudah `synced` (hasil DIVALIDASI), panggilan ini TIDAK
 * menurunkannya kembali — hanya metanya yang diperbarui. Jadi blok gossip
 * setelah sync tidak pernah menyalakan ulang gerbang mining.
 *
 * Fase `assumed` (katup pengaman) BUKAN latch: ia boleh diturunkan kembali ke
 * `syncing` bila kita kemudian menemukan bukti nyata bahwa rantai tertinggal.
 */
export const markSyncing = (meta?: SyncMeta): void => {
	if (phase !== 'synced') phase = 'syncing'
	applyMeta(meta)
	updatedAt = Date.now()
}

/**
 * Tandai node menganggap dirinya menyusul TANPA bukti tervalidasi — dipakai
 * katup pengaman saat tak ada kemajuan selama batas waktu. Mining DIBUKA
 * (`syncing` false), tetapi berbeda dari `synced`: fase ini masih boleh
 * diturunkan kembali ke `syncing` bila muncul bukti rantai tertinggal.
 */
export const markAssumed = (meta?: SyncMeta): void => {
	if (phase === 'synced') return
	phase = 'assumed'
	applyMeta(meta)
	updatedAt = Date.now()
}

/**
 * Tandai node sudah DIVALIDASI menyusul rantai peer (latch: melekat sampai
 * proses mati). Hanya dipakai saat sinyal "menyusul" benar-benar diperiksa
 * terhadap data lokal — lihat `syncManager.notifyCaughtUp`.
 */
export const markSynced = (meta?: SyncMeta): void => {
	phase = 'synced'
	applyMeta(meta)
	updatedAt = Date.now()
}

/**
 * Kembalikan ke `idle`. Dipakai uji dan (teoretis) siklus hidup P2P yang
 * di-restart di dalam proses yang sama.
 */
export const resetSyncState = (): void => {
	phase = 'idle'
	localHeight = 0
	targetHeight = 0
	updatedAt = 0
}
