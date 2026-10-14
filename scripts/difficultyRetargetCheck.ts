/**
 * Gerbang regresi "difficulty retarget berbasis waktu (opsi A)".
 *
 * Target blok kini 60 detik (`TARGET_BLOCK_TIME_MS`) — gerbang ini harus
 * bergerak BERSAMA konstanta itu: angka "target" di bawah diimpor dari
 * modul, bukan ditulis literal, supaya tidak pernah usang diam-diam.
 *
 * Bug yang dicegah: `createBlockTemplate` dulu memakai jarak
 * grandparent→tip sebagai `actualMs`. Saat rantai idle (job terus kadaluarsa
 * dan blok tak pernah ter-commit) jarak itu tetap ~target (kala itu 30
 * detik) sehingga
 * difficulty mandek (mis. 27.5) dan tidak pernah turun — padahal expiry
 * terjadi berulang. Opsi A menggantinya dengan `now - tip.timestamp` dan
 * menambah jalur expiry kumulatif (`cleanupExpiredJobs`).
 *
 * Seluruhnya murni: tidak ada RPC, tidak ada DB (job disimpan di memori),
 * tidak ada side effect — aman dijalankan kapan pun tanpa node hidup.
 *
 * Jalankan:  bun run check:difficulty
 *
 * Yang dipastikan:
 *   - retargetByTime: durasi == target -> tanpa koreksi
 *   - retargetByTime: kelipatan target (>= atau < 1) -> log2 lalu dikuantisasi 0.25
 *   - retargetByTime: idle panjang -> jatuh ke floor 8 bit
 *   - retargetByTime: blok sangat cepat -> naik tapi dijepit ceiling 48 bit
 *   - retargetByTime: jarak <= 0 / non-finite -> flat (guard, tanpa koreksi)
 *   - cleanupExpiredJobs: job hidup tidak disentuh, tidak ada -> undefined
 *   - cleanupExpiredJobs: basis job expired TERBARU, job dihapus setelahnya
 *   - cleanupExpiredJobs: penurunan kumulatif per expiry hingga floor 8
 */
import {
	retargetByTime,
	MIN_DIFFICULTY_BITS,
	MAX_DIFFICULTY_BITS,
	TARGET_BLOCK_TIME_MS,
} from 'src/core/consensus/difficulty'
import {
	createJob,
	getJob,
	cleanupExpiredJobs,
	JOB_TTL_MS,
} from 'src/core/consensus/jobStore'
import { Block } from 'src/core/block/blockModel'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? '  -> ' + extra : ''}`)
	}
}

// ============ 1. retargetByTime (murni, tanpa I/O) ============
const BASE = 27.5 // difficulty nyata yang diamati user saat idle
const T0 = 1_700_000_000_000 // anchor waktu acak — tidak bergantung Date.now()

console.log('retargetByTime:')

// Durasi == target -> langkah 0, difficulty tidak berubah.
const atTarget = TARGET_BLOCK_TIME_MS
ok(
	`${atTarget / 1000}s (target) -> tetap 27.5`,
	retargetByTime(BASE, T0, T0 + atTarget) === BASE,
)

// 2x target (120 detik) -> log2(0.5) = -1 bit persis.
ok('120s (2x target) -> 26.5', retargetByTime(BASE, T0, T0 + 120_000) === 26.5)

// 5x target (300 detik) -> log2(0.2) = -2.32 -> 25.18 -> kuantisasi 0.25 -> 25.25.
const r300 = retargetByTime(BASE, T0, T0 + 300_000)
ok('300s -> 25.25 (kuantisasi 0.25)', r300 === 25.25, `got ${r300}`)

// 0.5x target (30 detik) -> log2(2) = +1 bit.
ok('30s (0.5x target) -> 28.5', retargetByTime(BASE, T0, T0 + 30_000) === 28.5)

// Idle panjang: langkah di-clamp -4 lalu dijepit floor -> 9-4=5 -> 8.
const rFloor = retargetByTime(9, T0, T0 + 1_000_000_000)
ok(
	`idle panjang -> floor ${MIN_DIFFICULTY_BITS}`,
	rFloor === MIN_DIFFICULTY_BITS,
	`got ${rFloor}`,
)

// Blok sangat cepat (1 detik): langkah di-clamp +2 -> 47+2=49 -> ceiling 48.
const rCeil = retargetByTime(47, T0, T0 + 1_000)
ok(
	`sangat cepat -> ceiling ${MAX_DIFFICULTY_BITS}`,
	rCeil === MAX_DIFFICULTY_BITS,
	`got ${rCeil}`,
)

// Guard: jarak waktu negatif (kemunduran jam) -> flat, bukan koreksi.
ok('jarak negatif -> flat 27.5', retargetByTime(BASE, T0 + 5_000, T0) === BASE)

// Guard: timestamp non-finite -> flat, bukan NaN/Infinity.
ok('timestamp non-finite -> flat 20', retargetByTime(20, Number.NaN, T0) === 20)

// ============ 2. cleanupExpiredJobs (job kadaluarsa) ============
console.log('cleanupExpiredJobs:')

// jobStore hanya butuh field ini; `block` tidak disentuh oleh jalur cleanup.
const blockStub = {} as Block
const mkJob = (difficulty: number) =>
	createJob({
		block: blockStub,
		payload: 'payload-stub',
		difficulty,
		height: 1,
		previousBlockHash: '0xstub',
		minerAddress: 'NxC000000000000000000000000000000000000001',
	})

// --- A. tidak ada yang kadaluarsa -> undefined, job hidup tetap tersimpan ---
const live = mkJob(20)
ok(
	'tidak ada job kadaluarsa -> undefined',
	cleanupExpiredJobs(Date.now() - 30_000, Date.now()) === undefined,
)
ok('job hidup TIDAK disentuh', getJob(live.jobId) !== undefined)

// --- B. paksa expiry: basis = job expired TERBARU (27.5, bukan 20) ---
// actualMs = (now + TTL + 60s) - (now - 300s) = 660.000ms; langkah
// log2(60/660) ≈ -3.46 (di dalam clamp -4, jadi utuh) -> 24.04 -> kuantisasi
// -> 24. Bila basisnya job tertua (20) hasilnya 16.5, jadi angka 24
// membuktikan pemilihan "terbaru".
const exp = mkJob(27.5)
const lastTs = Date.now() - 300_000
const target = Date.now() + JOB_TTL_MS + 60_000
const rExp = cleanupExpiredJobs(lastTs, target)
ok(
	'expiry -> retarget dari job TERBARU (27.5 -> 24)',
	rExp === 24,
	`got ${rExp}`,
)
ok('job kadaluarsa dihapus', getJob(exp.jobId) === undefined)
ok('job ikut terhapus (map bersih)', getJob(live.jobId) === undefined)
ok(
	'pemanggilan ulang tanpa job sisa -> undefined',
	cleanupExpiredJobs(lastTs, target) === undefined,
)

// --- C. penurunan kumulatif per expiry hingga floor 8 ---
// Ini inti opsi A: tiap expiry turun ~3.46 bit dari titik terakhir, sehingga
// tidak pernah mandek selama blok tak pernah ter-commit, sampai mentok floor.
const seen: number[] = []
let cursor = 24
for (let i = 0; i < 7; i++) {
	mkJob(cursor)
	const next = cleanupExpiredJobs(
		Date.now() - 300_000,
		Date.now() + JOB_TTL_MS + 60_000,
	)
	if (next === undefined) break
	seen.push(next)
	cursor = next
}
ok(
	`penurunan kumulatif per expiry (${seen.join(' -> ')})`,
	seen.length === 7 &&
		seen[0] === 20.5 &&
		seen[1] === 17 &&
		seen[2] === 13.5 &&
		seen[3] === 10 &&
		seen[4] === MIN_DIFFICULTY_BITS &&
		seen[5] === MIN_DIFFICULTY_BITS &&
		seen[6] === MIN_DIFFICULTY_BITS,
)

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
