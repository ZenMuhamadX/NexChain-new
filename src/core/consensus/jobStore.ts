import { createHash, randomBytes } from 'node:crypto'
import { Block } from 'src/core/block/blockModel'

/**
 * Penyimpanan job mining **di memori node** (satu-satunya sumber kebenaran;
 * sengaja bukan LevelDB — job basi tidak perlu bertahan setelah restart:
 * miner cukup meminta job baru lewat `nex_getWork`).
 *
 * Setiap job membawa template blok lengkap + preimage PoW-nya. Saat
 * `nex_submitWork` masuk, node memverifikasi solusi terhadap payload yang
 * SAMA yang dikirimkannya (lihat `nexchain/miner/work.ts`).
 */

/** Umur job:5 menit — jauh di atas target 60 detik, cukup untuk miner lambat. */
export const JOB_TTL_MS = 5 * 60 * 1000

/** Batas job hidup bersamaan (mencegah memori bocor bila miner banyak submit job tapi jarang menyelesaikan). */
export const MAX_JOBS = 100

export interface MiningJob {
	jobId: string
	/** Template blok siap-PoW (belum ada nonce/hash/sign/size). */
	block: Block
	/** Preimage PoW = prepareBlockForHashing(template) — yang di-hash miner. */
	payload: string
	difficulty: number
	height: number
	previousBlockHash: string
	/** Alamat penerima hadiah — jadi `minerId` & receiver coinbase blok ini. */
	minerAddress: string
	createdAt: number
	expiresAt: number
}

const jobs = new Map<string, MiningJob>()

/**
 * Buang semua job kadaluarsa; kembalikan jumlah yang dibuang.
 *
 * Sejak M0 difficulty TIDAK lagi diturunkan dari jalur expiry — retarget kini
 * deterministik lewat `expectedDifficulty` (berbasis timestamp blok, lihat
 * `difficulty.ts`). Fungsi ini murni untuk memori: membebaskan slot `MAX_JOBS`
 * sebelum job baru dibuat.
 */
export const pruneExpiredJobs = (nowMs: number = Date.now()): number => {
	let pruned = 0
	for (const [id, job] of jobs) {
		if (job.expiresAt <= nowMs) {
			jobs.delete(id)
			pruned++
		}
	}
	return pruned
}

/**
 * String stabil berisi KONTEN template — bahan preimage `jobId`.
 *
 * Field yang dipilih adalah yang membuat template BEDA antar blok/miner:
 * tinggi, hash sebelumnya, difficulty, penerima hadiah, timestamp template
 * (beda tiap `getWork` walau tip sama), dan merkle root (beda bila daftar
 * transaksi berbeda). Urutan & label dipakukan supaya hasilnya deterministik
 * untuk konten yang sama — silakan bandingkan `jobContentFor` dua job.
 *
 * (Modul ini server-side saja — `node:crypto` di sini tidak masuk bundel
 * browser; terverifikasi oleh `check:browser`.)
 */
export const jobContentFor = (
	data: Omit<MiningJob, 'jobId' | 'createdAt' | 'expiresAt'>,
): string =>
	[
		`height=${data.height}`,
		`prev=${data.previousBlockHash}`,
		`difficulty=${data.difficulty}`,
		`miner=${data.minerAddress}`,
		// `?.` — jalur produksi SELALU mengirim template blok penuh, tapi
		// pemanggil uji boleh memakai stub minimal; ekstraksi tetap total
		// (field hilang menjadi "undefined" — deterministik, bukan throw).
		`timestamp=${data.block?.block?.header?.timestamp}`,
		`merkle=${data.block?.block?.merkleRoot}`,
	].join('\n')

/**
 * `jobId` = hex sha256(konten template ‖ 16 byte acak), tepat 64 karakter.
 *
 * Rationale (audit P1b #1):
 *   (a) ID diturunkan dari materi yang bisa diverifikasi ulang (konten
 *       template) — bukan angka yang dipilih sendiri sembarangan;
 *   (b) salt acak 16 byte menjamin KEUNIKAN: dua `getWork` dengan template
 *       identik (mis. miner berbeda di detik yang sama) tetap mendapat ID
 *       berbeda sehingga tidak berebut satu slot Map;
 *   (c) secara eksplisit BUKAN `Math.random` dan BUKAN UUID: `Math.random`
 *       punya seeding lemah dan kolisi 32-bit, dan UUID v4 juga berbasis
 *       `Math.random` di banyak runtime — keduanya tidak layak sebagai
 *       pemilih kunci antrean kerja.
 *
 * Kontrak pemakaian TIDAK berubah: `submitWork` memperlakukan `jobId`
 * sebagai kunci Map string non-kosong (`work.ts` parseSubmit/getJob) —
 * format 64-hex kompatibel. TTL/eviction/retarget di bawah ikut tak berubah.
 */
const jobIdFrom = (
	data: Omit<MiningJob, 'jobId' | 'createdAt' | 'expiresAt'>,
): string =>
	createHash('sha256')
		.update(jobContentFor(data))
		.update(randomBytes(16))
		.digest('hex')

/** Daftarkan job baru; otomatis buang yang expired & job tertua bila penuh. */
export const createJob = (
	data: Omit<MiningJob, 'jobId' | 'createdAt' | 'expiresAt'>,
): MiningJob => {
	const now = Date.now()
	pruneExpiredJobs(now)
	// Map mempertahankan urutan insert → key pertama = job tertua.
	while (jobs.size >= MAX_JOBS) {
		const oldest = jobs.keys().next().value
		if (oldest === undefined) break
		jobs.delete(oldest)
	}
	const job: MiningJob = {
		...data,
		jobId: jobIdFrom(data),
		createdAt: now,
		expiresAt: now + JOB_TTL_MS,
	}
	jobs.set(job.jobId, job)
	return job
}

/** Ambil job yang masih hidup; job expired ikut dibersihkan saat ditemukan. */
export const getJob = (jobId: string): MiningJob | undefined => {
	const job = jobs.get(jobId)
	if (!job) return undefined
	if (job.expiresAt <= Date.now()) {
		jobs.delete(jobId)
		return undefined
	}
	return job
}

export const deleteJob = (jobId: string): void => {
	jobs.delete(jobId)
}
