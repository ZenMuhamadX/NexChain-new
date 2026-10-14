/**
 * Gerbang regresi "difficulty retarget deterministik (M0)".
 *
 * Target blok 60 detik (`TARGET_BLOCK_TIME_MS`) — gerbang ini bergerak
 * BERSAMA konstanta itu: angka "target" diimpor dari modul, bukan ditulis
 * literal, supaya tidak pernah usang diam-diam.
 *
 * Model saat ini: `expectedDifficulty(parentBits, parentTs, blockTs,
 * parentHeight)` — murni fungsi data rantai, jadi SEMUA node menghitung angka
 * yang sama untuk blok yang sama (determinisme = mekanisme sinkronisasi).
 * Ini menggantikan retarget berbasis jam dinding (`retargetByTime`) dan jalur
 * expiry kumulatif (`cleanupExpiredJobs`) yang membuat angka berbeda antar node
 * dan mandek saat idle.
 *
 * Seluruhnya murni: tidak ada RPC, tidak ada DB (job disimpan di memori),
 * tidak ada side effect — aman dijalankan kapan pun tanpa node hidup.
 *
 * Jalankan:  bun run check:difficulty
 *
 * Yang dipastikan:
 *   - gap == target -> tanpa koreksi
 *   - gap == 2x target -> -1 bit (batas atas cabang halus)
 *   - gap > 2x target -> pemulihan borongan `-(ceil(gap/T)-1)`, dijepit -8
 *   - gap < target -> naik, dijepit +2 (max rise)
 *   - idle raksasa -> floor MIN; blok sangat cepat -> ceiling MAX
 *   - parentHeight <= 0 / gap <= 0 / non-finite -> flat (guard)
 *   - determinisme: dua panggilan dengan argumen sama -> hasil sama
 *   - pruneExpiredJobs: job hidup utuh, job kadaluarsa dibuang + dihitung
 */
import {
	expectedDifficulty,
	MIN_DIFFICULTY_BITS,
	MAX_DIFFICULTY_BITS,
	TARGET_BLOCK_TIME_MS,
} from 'src/core/consensus/difficulty'
import {
	createJob,
	getJob,
	pruneExpiredJobs,
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

// ============ 1. expectedDifficulty (murni, tanpa I/O) ============
const BASE = 27.5 // difficulty nyata yang diamati user saat idle
const T0 = 1_700_000_000_000 // anchor waktu acak — tidak bergantung Date.now()
const H = 100 // tinggi induk (>= 1 supaya retarget berlaku)
const T = TARGET_BLOCK_TIME_MS

console.log('expectedDifficulty:')

// gap == target -> langkah 0, difficulty tidak berubah.
ok(
	`${T / 1000}s (target) -> tetap 27.5`,
	expectedDifficulty(BASE, T0, T0 + T, H) === BASE,
)

// gap == 2x target -> log2(0.5) = -1 bit persis (batas atas cabang halus).
ok('2x target -> 26.5', expectedDifficulty(BASE, T0, T0 + 2 * T, H) === 26.5)

// gap > 2x target -> pemulihan BORONGAN: -(ceil(gap/T)-1). 5x -> -4.
ok(
	'5x target -> 23.5 (borongan -4)',
	expectedDifficulty(BASE, T0, T0 + 5 * T, H) === 23.5,
)

// 10x target -> -min(9, 8) = -8 (dijepit MAX_STALL_FALL_BITS).
ok(
	'10x target -> 19.5 (borongan -8, jepit)',
	expectedDifficulty(BASE, T0, T0 + 10 * T, H) === 19.5,
)

// gap == 0.5x target -> log2(2) = +1 bit.
ok('0.5x target -> 28.5', expectedDifficulty(BASE, T0, T0 + T / 2, H) === 28.5)

// Blok sangat cepat (1 detik): langkah di-clamp +2 -> 47+2=49 -> ceiling 48.
const rCeil = expectedDifficulty(47, T0, T0 + 1_000, H)
ok(
	`sangat cepat -> ceiling ${MAX_DIFFICULTY_BITS}`,
	rCeil === MAX_DIFFICULTY_BITS,
	`got ${rCeil}`,
)

// Idle raksasa: langkah di-clamp -8 lalu dijepit floor -> 9-8=1 -> 8.
const rFloor = expectedDifficulty(9, T0, T0 + 1_000_000_000, H)
ok(
	`idle raksasa -> floor ${MIN_DIFFICULTY_BITS}`,
	rFloor === MIN_DIFFICULTY_BITS,
	`got ${rFloor}`,
)

// Guard: tinggi induk 0 (blok pertama di atas genesis) -> flat.
ok(
	'parentHeight 0 -> flat 27.5',
	expectedDifficulty(BASE, T0, T0 + 10 * T, 0) === BASE,
)

// Guard: jarak waktu negatif (timestamp mundur) -> flat, bukan koreksi.
ok(
	'gap <= 0 -> flat 27.5',
	expectedDifficulty(BASE, T0 + 5_000, T0, H) === BASE,
)

// Guard: timestamp non-finite -> flat, bukan NaN/Infinity.
ok(
	'timestamp non-finite -> flat 20',
	expectedDifficulty(20, Number.NaN, T0, H) === 20,
)

// Determinisme: argumen identik -> hasil identik (inti model ini).
ok(
	'deterministik (dua panggilan sama)',
	expectedDifficulty(BASE, T0, T0 + 3 * T, H) ===
		expectedDifficulty(BASE, T0, T0 + 3 * T, H),
)

// Quirk batas cabang (didokumentasikan): gap = 2T -> -1, gap = 2T+1 -> -2.
ok(
	'batas cabang: gap=2T -> -1, gap=2T+1 -> -2',
	expectedDifficulty(BASE, T0, T0 + 2 * T, H) === 26.5 &&
		expectedDifficulty(BASE, T0, T0 + 2 * T + 1, H) === 25.5,
)

// ============ 2. pruneExpiredJobs (prune memori murni) ============
console.log('pruneExpiredJobs:')

// jobStore hanya butuh field ini; `block` tidak disentuh oleh jalur prune.
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

// --- A. tidak ada yang kadaluarsa -> 0 dibuang, job hidup tetap tersimpan ---
const live = mkJob(20)
ok('tidak ada job kadaluarsa -> 0', pruneExpiredJobs(Date.now()) === 0)
ok('job hidup TIDAK disentuh', getJob(live.jobId) !== undefined)

// --- B. paksa expiry: job dibuang dan dihitung ---
const exp = mkJob(27.5)
const pruned = pruneExpiredJobs(Date.now() + JOB_TTL_MS + 60_000)
ok('job kadaluarsa dihitung & dibuang', pruned >= 1, `got ${pruned}`)
ok('job kadaluarsa hilang', getJob(exp.jobId) === undefined)
ok('job hidup ikut terhapus (map bersih)', getJob(live.jobId) === undefined)
ok(
	'pemanggilan ulang tanpa job sisa -> 0',
	pruneExpiredJobs(Date.now() + JOB_TTL_MS + 60_000) === 0,
)

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
