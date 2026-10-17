/**
 * Gerbang regresi "penyimpanan job & blok (P1b)".
 *
 * Jalankan:  bun run check:storage
 *
 * Dua perbaikan yang dicegah regresinya:
 *
 *   1. **jobId deterministik-berbasis-hash** — `createJob` kini menghasilkan
 *      tepat 64 hex: sha256(konten template ‖ 16 byte acak). Yang diuji:
 *      format, keunikan dua job konten-sama (salt), kontribusi konten
 *      (height beda → string konten beda), penghapusan `Math.random` dari
 *      sumber modul, dan eviction `MAX_JOBS` yang tidak berubah.
 *   2. **Penulisan blok atomik** — `saveBlock` kini: guard dulu (nol tulis),
 *      badan blok sync ke DB blok, lalu SATU `rocksState.batch` sync untuk
 *      `blockHeight:<n>` + `blockState`. Yang diuji: spy pada method tulis
 *      singleton DB membuktikan TEPAT SATU batch dengan kedua key, tanpa
 *      `put` terpisah, sync:true; guard plafon menolak SEBELUM satu pun
 *      tulis tercatat; hasil commit terbaca utuh lewat jalur baca nyata
 *      (`getBlockState` + `getCurrentBlock`).
 *
 * Regresi TTL/prune job TIDAK diduplikasi di sini — `check:difficulty`
 * sudah menguji `pruneExpiredJobs` secara menyeluruh.
 *
 * Bagian jobId murni (impor statis). Bagian saveBlock memakai `NEX_DATA_DIR`
 * sementara (LevelDB nyata dibuang setelahnya) — modul DB diimpor SESUDAH
 * env diset, DB dibuka sebelum dipasangi spy, lalu method tulis singleton
 * di-spies (modul produksi tidak dimodifikasi; spy meneruskan tulisan ke
 * DB sungguhan lalu dipulihkan). Membuka DB lebih dulu penting:
 * `abstract-level` menunda operasi selama `open` dan mere-invokes method
 * publik saat drain, sehingga spy yang terpasang terlalu awal bisa
 * menghitung satu tulis logis dua kali.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
	createJob,
	getJob,
	jobContentFor,
	MAX_JOBS,
} from 'src/core/consensus/jobStore'
import { MAX_SUPPLY_NEXU } from 'src/core/token/constants'
import { Block } from 'src/core/block/blockModel'
import type { TxInterface } from 'src/types/transaction'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}${extra ? `  [${extra}]` : ''}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`)
	}
}

// ---------------------------------------------------------------------------
// GROUP 1 — jobId deterministik-berbasis-hash (murni)
// ---------------------------------------------------------------------------

console.log('GROUP 1 — jobId (hash konten ‖ salt acak):')

/** Data job minimum — `jobContentFor` hanya menyentuh field tercantum. */
const jobData = (
	height: number,
	previousBlockHash = 'PrevHashXX',
	difficulty = 20,
	minerAddress = `NxC${'11'.repeat(20)}`,
	timestamp = 1_700_000_000,
) => ({
	block: {
		block: {
			header: { timestamp },
			merkleRoot: `MerkleRoot-${height}`,
		},
	} as unknown as Block,
	payload: `payload-${height}`,
	difficulty,
	height,
	previousBlockHash,
	minerAddress,
})

const HEX64 = /^[0-9a-f]{64}$/
const job1 = createJob(jobData(5))
ok('jobId = tepat 64 karakter hex', HEX64.test(job1.jobId), job1.jobId)

const job2 = createJob(jobData(5)) // konten identik, salt pasti beda
ok(
	'dua createJob konten SAMA → jobId BERBEDA (salt acak)',
	job1.jobId !== job2.jobId,
)
ok('jobId kedua juga 64-hex', HEX64.test(job2.jobId))

ok(
	'konten masuk preimage: height beda → string konten beda',
	jobContentFor(jobData(5)) !== jobContentFor(jobData(6)),
)
ok(
	'konten konten-sama → string konten identik (deterministik)',
	jobContentFor(jobData(5)) === jobContentFor(jobData(5)),
)
ok(
	'konten ikut membedakan timestamp & merkle (bukan hanya height)',
	jobContentFor(jobData(5, 'A', 20, `NxC${'11'.repeat(20)}`, 1)) !==
		jobContentFor(jobData(5, 'A', 20, `NxC${'11'.repeat(20)}`, 2)),
)

// Sumber: Math.random hilang dari modul jobStore; node:crypto masuk.
// (Catatan: menyebut nama `Math.random` di KOMENTAR rationale diperbolehkan
// — yang dilarang adalah pemakaian berupa panggilan `Math.random()`.)
const jobStoreSource = fs.readFileSync(
	path.join(process.cwd(), 'src', 'core', 'consensus', 'jobStore.ts'),
	'utf8',
)
ok(
	'sumber jobStore tidak lagi memanggil Math.random()',
	!jobStoreSource.includes('Math.random()'),
)
ok(
	'sumber jobStore memakai randomBytes (salt) + sha256',
	jobStoreSource.includes('randomBytes') && jobStoreSource.includes('sha256'),
)

// Eviction MAX_JOBS tidak berubah: job tertua keluar lebih dulu.
const ids: string[] = []
for (let i = 0; i <= MAX_JOBS; i++) {
	ids.push(
		createJob(jobData(1000 + i, 'Evict', 20, `NxC${'22'.repeat(20)}`)).jobId,
	)
}
const oldestGone = getJob(ids[0]) === undefined
const newestStay = getJob(ids[MAX_JOBS]) !== undefined
ok(
	`eviction MAX_JOBS (${MAX_JOBS}) tidak berubah: tertua keluar, terbaru tetap`,
	oldestGone && newestStay,
)

// ---------------------------------------------------------------------------
// GROUP 2 — saveBlock atomik (LevelDB temp + spy method tulis singleton)
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-storage-'))
process.env.NEX_DATA_DIR = tmpDir

const { saveBlock } = await import('src/core/state/storage/block/saveBlock')
const { rocksState } = await import('src/core/state/db/state')
const { rocksBlock } = await import('src/core/state/db/block')
const { getBlockState } = await import('src/core/state/storage/state/getState')
const { getCurrentBlock } =
	await import('src/core/block/query/onChain/block/getCurrentBlock')

// Buka KEDUA DB sebelum memasang spy. `abstract-level` menunda operasi
// selama `open` dan MEMANGGUL ULANG method publik saat drain — spy yang
// terpasang lebih awal akan mencatat SATU logika tulis DUA kali (bukan
// karena produksi menulis dua kali, tetapi karena antrean tunda
// mere-invokes wrapper). Membuka dulu membuat setiap entri spy
// berpadanan satu-satu dengan panggilan logis.
await rocksState.open()
await rocksBlock.open()

console.log('\nGROUP 2 — saveBlock atomik (spy + LevelDB temp):')

interface WriteCall {
	db: 'state' | 'block'
	method: 'put' | 'batch'
	keys: string[]
	sync: unknown
}
const calls: WriteCall[] = []

// Spy pass-through pada singleton DB: mencatat setiap panggilan tulis lalu
// meneruskannya ke DB sungguhan. Dipulihkan setelah pengujian — modul
// produksi TIDAK dimodifikasi.
type AnyFn = (...args: never[]) => Promise<unknown>
const origStatePut = rocksState.put.bind(rocksState) as unknown as AnyFn
const origStateBatch = rocksState.batch.bind(rocksState) as unknown as AnyFn
const origBlockPut = rocksBlock.put.bind(rocksBlock) as unknown as AnyFn
;(rocksState as unknown as { put: AnyFn }).put = ((
	key: string,
	value: unknown,
	opts?: { sync?: boolean },
) => {
	calls.push({
		db: 'state',
		method: 'put',
		keys: [String(key)],
		sync: opts?.sync,
	})
	return origStatePut(key as never, value as never, opts as never)
}) as AnyFn
;(rocksState as unknown as { batch: AnyFn }).batch = ((
	ops: Array<{ key: string }>,
	opts?: { sync?: boolean },
) => {
	calls.push({
		db: 'state',
		method: 'batch',
		keys: ops.map((o) => String(o.key)),
		sync: opts?.sync,
	})
	return origStateBatch(ops as never, opts as never)
}) as AnyFn
;(rocksBlock as unknown as { put: AnyFn }).put = ((
	key: string,
	value: unknown,
	opts?: { sync?: boolean },
) => {
	calls.push({
		db: 'block',
		method: 'put',
		keys: [String(key)],
		sync: opts?.sync,
	})
	return origBlockPut(key as never, value as never, opts as never)
}) as AnyFn

const restoreSpies = (): void => {
	;(rocksState as unknown as { put: unknown }).put = origStatePut
	;(rocksState as unknown as { batch: unknown }).batch = origStateBatch
	;(rocksBlock as unknown as { put: unknown }).put = origBlockPut
}

const MINER = `NxC${'ab'.repeat(20)}`
const fixtureBlock = (hash: string, height: number, prev: string): Block =>
	new Block({
		header: {
			previousBlockHash: prev,
			timestamp: 1_700_000_000 + height,
			hash,
			nonce: 0,
			version: '1.0.0',
			difficulty: 20,
			hashingAlgorithm: 'SHA256',
		},
		height,
		size: 1,
		merkleRoot: `Merkle-${height}`,
		minerId: MINER,
		blockReward: 500,
		totalReward: 500,
		status: 'confirmed',
		totalTransactionFees: 0,
		coinbaseTransaction: { amount: 500, receiver: MINER, extraData: '0x00' },
		metadata: {
			extraData: '0x00',
			txCount: 0,
			created_at: 1_700_000_000 + height,
		},
		transactions: [] as TxInterface[],
	})

try {
	// ---- commit blok height 1 ----
	const H1 = 'HashBlok1'
	const saved1 = await saveBlock(fixtureBlock(H1, 1, 'PrevGenesis'))
	ok('saveBlock(height 1) → true', saved1 === true)

	ok(
		'jalur commit = TEPAT SATU batch state + SATU put badan (tanpa put terpisah)',
		calls.length === 2 &&
			calls[0].db === 'block' &&
			calls[0].method === 'put' &&
			calls[1].db === 'state' &&
			calls[1].method === 'batch',
		JSON.stringify(calls),
	)
	ok(
		'batch state memuat SEMUA key atomik: blockHeight:1 + blockState',
		calls[1].keys.length === 2 &&
			calls[1].keys.includes('blockHeight:1') &&
			calls[1].keys.includes('blockState'),
		calls[1].keys.join(','),
	)
	ok(
		'tidak ada rocksState.put terpisah (hanya batch)',
		!calls.some((c) => c.db === 'state' && c.method === 'put'),
	)
	ok(
		'badan blok & batch keduanya sync:true (tahan-crash)',
		calls[0].sync === true && calls[1].sync === true,
	)
	ok(
		'key badan blok = blockHash:<hash> sesuai format baca',
		calls[0].keys[0] === `blockHash:${H1}`,
		calls[0].keys[0],
	)

	// ---- hasil commit terbaca utuh lewat jalur baca NYATA ----
	const state1 = await getBlockState()
	ok(
		'getBlockState: height 1, hash H1, totalIssued = Σ reward',
		state1?.currentBlockHeight === 1 &&
			state1?.currentBlockHash === H1 &&
			state1?.totalIssued === 500,
		JSON.stringify(state1),
	)
	const tip1 = (await getCurrentBlock()) as Block
	ok(
		'getCurrentBlock membaca balik blok tersimpan (blockState ↔ blockHash konsisten)',
		tip1.block.header.hash === H1 && tip1.block.height === 1,
	)

	// ---- guard plafon: tolak SEBELUM satu pun tulis ----
	const callsBefore = calls.length
	const poisoned = fixtureBlock('HashBlokX', 99, H1)
	;(poisoned.block as unknown as { blockReward: number }).blockReward =
		MAX_SUPPLY_NEXU + 1
	const savedBad = await saveBlock(poisoned)
	const stateAfterBad = await getBlockState()
	ok(
		'blok melebihi plafon → saveBlock false DAN nol tulis tercatat',
		savedBad === false && calls.length === callsBefore,
		`writes=${calls.length - callsBefore}`,
	)
	ok(
		'blockState tidak berubah oleh penolakan (tetap height 1)',
		stateAfterBad?.currentBlockHeight === 1 &&
			stateAfterBad?.currentBlockHash === H1,
	)

	// ---- commit berikutnya tetap konsisten ----
	const H2 = 'HashBlok2'
	const saved2 = await saveBlock(fixtureBlock(H2, 2, H1))
	const state2 = await getBlockState()
	ok(
		'commit height 2: batch lagi, state maju (height 2, totalIssued 1000)',
		saved2 === true &&
			calls.length === callsBefore + 2 &&
			state2?.currentBlockHeight === 2 &&
			state2?.currentBlockHash === H2 &&
			state2?.totalIssued === 1000,
		`totalIssued=${state2?.totalIssued}`,
	)
	const tip2 = (await getCurrentBlock()) as Block
	ok(
		'tip terbaca = blok height 2',
		tip2.block.height === 2 && tip2.block.header.hash === H2,
	)
} finally {
	restoreSpies()
}

// ---------------------------------------------------------------------------
// tutup storage & buang folder sementara
// ---------------------------------------------------------------------------

await rocksState.close().catch(() => undefined)
await rocksBlock.close().catch(() => undefined)
try {
	fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {
	console.log(`  (catatan) tidak bisa menghapus ${tmpDir} — dilewati`)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
