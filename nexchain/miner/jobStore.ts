import { Block } from 'nexchain/model/block/block'

/**
 * Penyimpanan job mining **di memori node** (satu-satunya sumber kebenaran;
 * sengaja bukan LevelDB — job basi tidak perlu bertahan setelah restart:
 * miner cukup meminta job baru lewat `nex_getWork`).
 *
 * Setiap job membawa template blok lengkap + preimage PoW-nya. Saat
 * `nex_submitWork` masuk, node memverifikasi solusi terhadap payload yang
 * SAMA yang dikirimkannya (lihat `nexchain/miner/work.ts`).
 */

/** Umur job:5 menit — jauh di atas target 30 detik, cukup untuk miner lambat. */
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
		jobId: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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
