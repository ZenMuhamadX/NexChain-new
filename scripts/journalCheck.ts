/**
 * Gerbang regresi "undo journal (M1)".
 *
 * Jalankan:  bun run check:journal
 *
 * Menguji penjamin crash-consistency + fondasi reorg (lihat
 * `journal-difficulty-design.md` Bagian A). Yang dibuktikan:
 *
 *   A. **Guard fail-closed** — selama journal aktif, menulis kunci state/
 *      history/block yang TIDAK terenumerasi → `JournalGuardError` (bukan
 *      dicatat diam-diam). Diuji lewat `putAccount`/`saveBlock`/
 *      `writeBlockHash`/`saveTxHistory`.
 *   B. **touch-set == tulisan aktual** — spy pada method tulis singleton DB
 *      saat `commitBlock` nyata membuktikan SEMUA kunci yang ditulis persis
 *      sama dengan `enumerateTouchSet(blok)` (tak ada kunci bocor, tak ada
 *      kelebihan).
 *   C. **rollback persis** — commit 3 blok, `rollbackAbove(1)`, dan dump
 *      state+history+block harus SAMA PERSIS dengan keadaan setelah blok 1
 *      (round-trip undo journal).
 *   D. **recovery boot** — tulis WAL untuk blok yang commit-nya "crash" di
 *      tengah (sebagian tulisan sudah jalan), lalu `recoverJournal()` harus
 *      mengembalikan state ke sebelum crash dan membuang journal yatim.
 *   E. **prune** — `pruneJournal` hanya menyimpan `MAX_REORG_DEPTH` record
 *      terbaru.
 *
 * Memakai `NEX_DATA_DIR` sementara (LevelDB nyata, dibuang setelahnya).
 * Modul DB diimpor SESUDAH env diset; DB dibuka SEBELUM spy dipasang
 * (`abstract-level` mere-invokes method publik saat drain — spy yang
 * terpasang terlalu awal bisa menghitung satu tulis logis dua kali).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  v  ${name}`)
	} else {
		fail++
		console.log(`  X  ${name}${extra ? `  [${extra}]` : ''}`)
	}
}

const deepEqual = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// DB temp + impor dinamis (env harus diset SEBELUM modul DB diimpor)
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-journal-'))
process.env.NEX_DATA_DIR = tmpDir

const { rocksState } = await import('src/core/state/db/state')
const { rocksHistory } = await import('src/core/state/db/history')
const { rocksBlock } = await import('src/core/state/db/block')
const { rocksJournal } = await import('src/core/state/db/journal')
const { getGenesisBlock } = await import('src/core/block/genesis')
const { putAccount } = await import('src/core/state/account/putAccount')
const { saveBlock } = await import('src/core/state/storage/block/saveBlock')
const { writeBlockHash } =
	await import('src/core/state/storage/block/writeBlockHash')
const { saveTxHistory } = await import('src/core/transaction/saveTxHistory')
const { getBlockState } = await import('src/core/state/storage/state/getState')
const { getAccount } = await import('src/core/state/account/getAccount')
const { chains } = await import('src/core/block/initBlock')
const { createBlockTemplate } =
	await import('src/core/block/createBlockTemplate')
const { enumerateTouchSet } = await import('src/core/state/journal/entry')
const journal = await import('src/core/state/journal/store')
const guard = await import('src/core/state/journal/guard')

await rocksState.open()
await rocksHistory.open()
await rocksBlock.open()
await rocksJournal.open()

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

type AnyLevel = {
	iterator: () => AsyncIterable<[string, unknown]>
}
const dump = async (db: AnyLevel): Promise<Array<[string, string]>> => {
	const out: Array<[string, string]> = []
	for await (const [k, v] of db.iterator()) {
		out.push([String(k), typeof v === 'string' ? v : JSON.stringify(v)])
	}
	out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
	return out
}
const dumpAll = async () => ({
	state: await dump(rocksState),
	history: await dump(rocksHistory),
	block: await dump(rocksBlock),
})

const MINER = `NxC${'ab'.repeat(20)}`

const balanceOf = (address: string, balance: number) => ({
	address,
	balance,
	transactionCount: 1,
	isContract: false,
	lastTransactionDate: 1_700_000_000_000,
	nonce: 0,
})

const commitNext = async (miner: string) => {
	const template = await createBlockTemplate([], miner)
	const result = await chains.commitBlock(template)
	return { template, result }
}

// ---------------------------------------------------------------------------
// bootstrap genesis (jalur yang sama dengan server.ts)
// ---------------------------------------------------------------------------

{
	const genesis = getGenesisBlock()
	const receiver = genesis.block.coinbaseTransaction.receiver
	await putAccount(
		receiver,
		balanceOf(receiver, genesis.block.coinbaseTransaction.amount),
	)
	const saved = await saveBlock(genesis)
	ok('bootstrap genesis tersimpan', saved === true)
}

// ---------------------------------------------------------------------------
// GROUP A — guard fail-closed
// ---------------------------------------------------------------------------
console.log('\nGROUP A — guard fail-closed (journal aktif):')

guard.beginJournalContext({
	state: new Set<string>(),
	history: new Set<string>(),
	block: new Set<string>(),
})

let threwPut = false
try {
	const addr = `NxC${'99'.repeat(20)}`
	await putAccount(addr, balanceOf(addr, 1))
} catch (error) {
	threwPut = guard.isJournalGuardError(error)
}
ok('putAccount kunci tak terdaftar → JournalGuardError', threwPut)

let threwHistory = false
try {
	await saveTxHistory('aa'.repeat(32), {
		nonce: 0,
		fee: 0,
		from: 'x',
		receiver: 'y',
		amount: 1,
		data: '0x',
		sign: { v: 0, r: '0'.repeat(64), s: '0'.repeat(64) },
	})
} catch (error) {
	threwHistory = guard.isJournalGuardError(error)
}
ok('saveTxHistory kunci tak terdaftar → JournalGuardError', threwHistory)

let threwBlock = false
try {
	await writeBlockHash('GuardHash', getGenesisBlock())
} catch (error) {
	threwBlock = guard.isJournalGuardError(error)
}
ok('writeBlockHash kunci tak terdaftar → JournalGuardError', threwBlock)

let threwSave = false
try {
	await saveBlock(getGenesisBlock())
} catch (error) {
	threwSave = guard.isJournalGuardError(error)
}
ok('saveBlock kunci state tak terdaftar → JournalGuardError', threwSave)

guard.endJournalContext()
ok('guard tidak aktif → tulisan normal boleh lagi', !guard.isJournalActive())

// ---------------------------------------------------------------------------
// GROUP B — touch-set == tulisan aktual (spy pada commit nyata)
// ---------------------------------------------------------------------------
console.log('\nGROUP B — touch-set == tulisan aktual (spy commit blok 1):')

interface WriteCall {
	db: 'state' | 'history' | 'block'
	keys: string[]
}
const calls: WriteCall[] = []
type AnyFn = (...args: never[]) => Promise<unknown>

const origStatePut = rocksState.put.bind(rocksState) as unknown as AnyFn
const origStateBatch = rocksState.batch.bind(rocksState) as unknown as AnyFn
const origHistoryPut = rocksHistory.put.bind(rocksHistory) as unknown as AnyFn
const origBlockPut = rocksBlock.put.bind(rocksBlock) as unknown as AnyFn

;(rocksState as unknown as { put: AnyFn }).put = ((...args: never[]) => {
	calls.push({ db: 'state', keys: [String(args[0])] })
	return origStatePut(...args)
}) as AnyFn
;(rocksState as unknown as { batch: AnyFn }).batch = ((...args: never[]) => {
	const ops = args[0] as unknown as Array<{ key: string }>
	calls.push({ db: 'state', keys: ops.map((o) => String(o.key)) })
	return origStateBatch(...args)
}) as AnyFn
;(rocksHistory as unknown as { put: AnyFn }).put = ((...args: never[]) => {
	calls.push({ db: 'history', keys: [String(args[0])] })
	return origHistoryPut(...args)
}) as AnyFn
;(rocksBlock as unknown as { put: AnyFn }).put = ((...args: never[]) => {
	calls.push({ db: 'block', keys: [String(args[0])] })
	return origBlockPut(...args)
}) as AnyFn

const restoreSpies = (): void => {
	;(rocksState as unknown as { put: unknown }).put = origStatePut
	;(rocksState as unknown as { batch: unknown }).batch = origStateBatch
	;(rocksHistory as unknown as { put: unknown }).put = origHistoryPut
	;(rocksBlock as unknown as { put: unknown }).put = origBlockPut
}

const { template: tpl1, result: res1 } = await commitNext(MINER)
restoreSpies()

ok('commitBlock blok 1 sukses dengan guard aktif', res1.status === true)

const actualKeys = new Set<string>()
for (const call of calls) {
	for (const key of call.keys) actualKeys.add(`${call.db}:${key}`)
}
const touch1 = enumerateTouchSet(tpl1)
const expectedKeys = new Set<string>([
	...[...touch1.state].map((k) => `state:${k}`),
	...[...touch1.history].map((k) => `history:${k}`),
	...[...touch1.block].map((k) => `block:${k}`),
])
const missing = [...expectedKeys].filter((k) => !actualKeys.has(k))
const extra = [...actualKeys].filter((k) => !expectedKeys.has(k))
ok(
	'touch-set == tulisan aktual (tak ada kunci bocor / berlebih)',
	missing.length === 0 && extra.length === 0,
	`missing=[${missing}] extra=[${extra}]`,
)

const dumpAfter1 = await dumpAll()
ok(
	'journal:<1> tertulis dan dapat dibaca',
	(await journal.listJournalHeights()).includes(1),
)

// ---------------------------------------------------------------------------
// GROUP C — round-trip rollback persis
// ---------------------------------------------------------------------------
console.log('\nGROUP C — rollback persis (commit 3 → rollbackAbove(1)):')

const { result: res2 } = await commitNext(MINER)
const { result: res3 } = await commitNext(MINER)
ok('commit blok 2 & 3 sukses', res2.status === true && res3.status === true)

const heightsBefore = await journal.listJournalHeights()
ok(
	'journal memuat tinggi 1..3',
	heightsBefore.includes(1) &&
		heightsBefore.includes(2) &&
		heightsBefore.includes(3),
	heightsBefore.join(','),
)

const rolled = await journal.rollbackAbove(1)
ok('rollbackAbove(1) membalik 2 blok', rolled === 2, `rolled=${rolled}`)

const dumpRolled = await dumpAll()
ok(
	'state+history+block setelah rollback == keadaan setelah blok 1',
	deepEqual(dumpRolled, dumpAfter1),
)

const heightsAfter = await journal.listJournalHeights()
ok(
	'journal 2 & 3 dibuang, journal 1 tetap',
	!heightsAfter.includes(2) &&
		!heightsAfter.includes(3) &&
		heightsAfter.includes(1),
	heightsAfter.join(','),
)

const stRolled = await getBlockState()
ok(
	'blockState kembali ke tinggi 1',
	stRolled?.currentBlockHeight === 1,
	String(stRolled?.currentBlockHeight),
)

// Re-commit (replay) setelah rollback harus sukses lagi — fondasi reorg.
const { result: res2b } = await commitNext(MINER)
ok('commit ulang blok 2 (replay) sukses', res2b.status === true)

// ---------------------------------------------------------------------------
// GROUP D — recovery boot (crash di tengah commit)
// ---------------------------------------------------------------------------
console.log('\nGROUP D — recovery boot (simulasi crash):')

// Bawa kembali ke tinggi 1 dulu supaya konteks bersih.
await journal.rollbackAbove(1)
const dumpStable = await dumpAll()

const crashTemplate = await createBlockTemplate([], MINER)
const { record: crashRecord } =
	await journal.prepareJournalRecord(crashTemplate)
await journal.writeJournalRecord(crashRecord)
// "Tulisan sebagian": kredit miner secara manual (seolah saveBlock/
// processTransact sudah mulai) — TANPA menaikkan blockState.
const before = await getAccount(MINER)
await putAccount(MINER, balanceOf(MINER, (before?.balance ?? 0) + 999_999))

const rolledCrash = await journal.recoverJournal()
ok(
	'recoverJournal membalik 1 journal yatim (h > tip)',
	rolledCrash === 1,
	`rolled=${rolledCrash}`,
)

const dumpRecovered = await dumpAll()
ok(
	'state setelah recovery == sebelum crash',
	deepEqual(dumpRecovered, dumpStable),
)
ok(
	'journal yatim dibuang setelah recovery',
	!(await journal.listJournalHeights()).includes(2),
)
ok(
	'recoverJournal idempoten (panggilan kedua = 0)',
	(await journal.recoverJournal()) === 0,
)

// ---------------------------------------------------------------------------
// GROUP E — prune
// ---------------------------------------------------------------------------
console.log('\nGROUP E — prune MAX_REORG_DEPTH:')

ok('MAX_REORG_DEPTH = 128', journal.MAX_REORG_DEPTH === 128)

const fake = (h: number) => ({ height: h, hash: `fake${h}`, entries: [] })
for (const h of [5, 6, 7, 100]) {
	await rocksJournal.put(`journal:${h}`, fake(h), { sync: true })
}
await journal.pruneJournal(200) // cutoff = 200 - 128 = 72
const afterPrune = await journal.listJournalHeights()
ok(
	'record <= tip-128 dibuang; yang lebih baru disimpan',
	!afterPrune.includes(5) &&
		!afterPrune.includes(6) &&
		!afterPrune.includes(7) &&
		afterPrune.includes(100),
	afterPrune.join(','),
)

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
await rocksState.close().catch(() => undefined)
await rocksHistory.close().catch(() => undefined)
await rocksBlock.close().catch(() => undefined)
await rocksJournal.close().catch(() => undefined)
try {
	fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {
	console.log(`  (catatan) tidak bisa menghapus ${tmpDir} — dilewati`)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
