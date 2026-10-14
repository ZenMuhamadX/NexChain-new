import { createHash, randomBytes } from 'node:crypto'
import { Block } from 'src/core/block/blockModel'
import { retargetByTime } from './difficulty'
import { logToConsole } from 'src/logging/logging'

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

const pruneExpired = (now: number): void => {
	for (const [id, job] of jobs) {
		if (job.expiresAt <= now) jobs.delete(id)
	}
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
	pruneExpired(now)
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

/**
 * Buang semua job kadaluarsa **dan** hitung retarget SATU KALI dari
 * difficulty job kadaluarsa TERBARU (`createdAt` terbesar).
 *
 * Kenapa basisnya job expired (kumulatif), bukan tip:
 * retarget berbasis tip hanya bisa turun maks `-MAX_FALL_BITS` (-4) per
 * pemanggilan, dan basisnya selalu `tip.difficulty`. Selama blok tidak pernah
 * ter-commit, tip tidak bergerak → difficulty mandek di `tip - 4` dan tak
 * pernah menyentuh floor (bisa jauh di atasnya). Dengan mengambil difficulty
 * job expired TERBARU sebagai basis, tiap expiry turun dari titik terakhir →
 * penurunan kumulatif `-4` per siklus hingga floor 8, walau blok tak pernah
 * ter-commit sekalipun.
 *
 * Job yang masih hidup TIDAK disentuh (hanya yang `expiresAt <= nowMs`).
 * `nowMs` bisa diinjeksi untuk pengujian.
 *
 * @param lastBlockTimestampMs timestamp tip (epoch ms) — dasar `actualMs`.
 * @param nowMs waktu sekarang (epoch ms), default `Date.now()`.
 * @returns difficulty hasil retarget, atau `undefined` bila tidak ada job
 *          kadaluarsa (tidak ada retarget jalur expiry).
 */
export const cleanupExpiredJobs = (
	lastBlockTimestampMs: number,
	nowMs: number = Date.now(),
): number | undefined => {
	// Map mempertahankan urutan insert; job expired TERBARU = createdAt
	// terbesar (bila seri, yang belakangan disisipkan menang).
	let newestExpired: MiningJob | undefined
	for (const [id, job] of jobs) {
		if (job.expiresAt > nowMs) continue
		jobs.delete(id)
		if (!newestExpired || job.createdAt >= newestExpired.createdAt) {
			newestExpired = job
		}
	}
	if (!newestExpired) return undefined

	const from = newestExpired.difficulty
	const to = retargetByTime(from, lastBlockTimestampMs, nowMs)
	logToConsole(
		`Retarget expiry: actual ${nowMs - lastBlockTimestampMs}ms, ` +
			`delta ${to - from >= 0 ? '+' : ''}${to - from}, ` +
			`${from} → ${to} bits, reason=expiry`,
	)
	return to
}
