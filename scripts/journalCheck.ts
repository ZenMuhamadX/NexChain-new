/**
 * Gerbang regresi "undo journal (M1)".
 *
 * Jalankan:  bun run check:journal
 *
 * Yang dibuktikan (lihat `src/core/state/journal/README.md`):
 *
 *   A. **Isolasi write-buffer** — selama commit, tulisan tidak menyentuh DB;
 *      `bufferGet` melihat tulisan yang belum di-flush; `prev` diambil dari
 *      nilai sebelum blok; `discard` membuang semuanya.
 *   B. **journal == tulisan aktual** — spy pada method tulis singleton DB saat
 *      `commitBlock` nyata: setiap kunci yang ditulis ke DB ADA di record
 *      journal (tak ada tulisan tanpa undo), dan `committed:<h>` tertulis.
 *   C. **rollback persis** — commit 3 blok, `rollbackAbove(1)`, dan dump
 *      state+history+block harus SAMA PERSIS dengan keadaan setelah blok 1.
 *      Record dengan hash salah DITOLAK (bukan rollback ke rantai lain).
 *   D. **recovery boot** — crash di tiap titik: sebelum WAL (nol tulisan),
 *      setelah WAL+flush sebelum `committed` (dibalik), dan setelah
 *      `committed` (TIDAK dibalik).
 *   E. **prune** — `pruneJournal` menyimpan `MAX_REORG_DEPTH` record terbaru
 *      beserta penandanya, membuang sisanya.
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
const { getBlockState } = await import('src/core/state/storage/state/getState')
const { getAccount } = await import('src/core/state/account/getAccount')
const { processReceiver } =
	await import('src/core/transaction/receiver/processReceiver')
const { processTransact } =
	await import('src/core/transaction/processTransaction')
const { chains } = await import('src/core/block/initBlock')
const { createBlockTemplate } =
	await import('src/core/block/createBlockTemplate')
const journal = await import('src/core/state/journal/store')
const buf = await import('src/core/state/journal/writeBuffer')

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
	lastTransactionDate: 1_700_000_000_000,
	nonce: 0,
})

/**
 * Template + commit satu blok. Hash diisi unik karena `commitBlock` tidak
 * memverifikasi PoW: tanpa hash, `blockHeight:<n>` berisi string kosong dan
 * blok itu tidak bisa dipakai sebagai induk (baseline `stateRoot`).
 */
let fakeHash = 1
const commitNext = async (miner: string) => {
	const template = await createBlockTemplate([], miner)
	template.block.header.hash = (fakeHash++).toString(16).padStart(64, '0')
	const result = await chains.commitBlock(template)
	return { template, result }
}

/** Nilai mentah sebuah kunci, atau `null` bila belum ada. */
const raw = async (key: string): Promise<unknown> =>
	await rocksState.get(key).catch(() => null)

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
// GROUP A — isolasi write-buffer
// ---------------------------------------------------------------------------
console.log('\nGROUP A — write-buffer (nol tulis sebelum flush):')
{
	const addr = `NxC${'99'.repeat(20)}`
	const before = await raw(addr)

	buf.beginWriteBuffer()
	await putAccount(addr, balanceOf(addr, 1))
	ok(
		'selama buffer aktif, DB TIDAK berubah (0 tulis)',
		(await raw(addr)) === before,
	)
	ok(
		'bufferGet melihat tulisan yang belum di-flush',
		(await getAccount(addr))?.balance === 1,
	)

	const entries = buf.bufferEntries()
	ok(
		'entry journal == kunci yang ditulis, prev null untuk kunci baru',
		entries.length === 1 &&
			entries[0].store === 'state' &&
			entries[0].key === addr &&
			entries[0].prev === null,
		JSON.stringify(entries),
	)

	buf.discardWriteBuffer()
	ok('discard ⟹ tidak ada yang tertulis', (await raw(addr)) === before)

	// `prev` untuk kunci yang SUDAH ada = nilai sebelum blok (bukan hasil
	// tulisan sebelumnya di blok yang sama).
	const holder = getGenesisBlock().block.coinbaseTransaction.receiver
	const prevRaw = await raw(holder)
	buf.beginWriteBuffer()
	await putAccount(holder, balanceOf(holder, 5))
	await putAccount(holder, balanceOf(holder, 6))
	const prevEntries = buf.bufferEntries()
	ok(
		'prev diambil sekali (sentuhan pertama), tidak ditimpa',
		prevEntries.length === 1 && prevEntries[0].prev === prevRaw,
		String(prevEntries[0]?.prev),
	)
	await buf.flushWriteBuffer()
	buf.discardWriteBuffer()
	ok(
		'flush menulis nilai TERAKHIR ke DB',
		(await getAccount(holder))?.balance === 6,
	)

	// Kembalikan baseline: flushes di atas ditulis langsung (tanpa journal).
	await rocksState.del(addr)
	await putAccount(
		holder,
		balanceOf(holder, getGenesisBlock().block.coinbaseTransaction.amount),
	)
}

// ---------------------------------------------------------------------------
// GROUP B — journal == tulisan aktual (spy pada commit nyata)
// ---------------------------------------------------------------------------
console.log('\nGROUP B — journal == tulisan aktual (spy commit blok 1):')

interface WriteCall {
	db: 'state' | 'history' | 'block'
	keys: string[]
}
const calls: WriteCall[] = []
type AnyFn = (...args: never[]) => Promise<unknown>

const origStatePut = rocksState.put.bind(rocksState) as unknown as AnyFn
const origStateBatch = rocksState.batch.bind(rocksState) as unknown as AnyFn
const origStateDel = rocksState.del.bind(rocksState) as unknown as AnyFn
const origHistoryPut = rocksHistory.put.bind(rocksHistory) as unknown as AnyFn
const origHistoryBatch = rocksHistory.batch.bind(
	rocksHistory,
) as unknown as AnyFn
const origBlockPut = rocksBlock.put.bind(rocksBlock) as unknown as AnyFn
const origBlockBatch = rocksBlock.batch.bind(rocksBlock) as unknown as AnyFn

const spyBatch =
	(db: WriteCall['db']) =>
	(...args: never[]) => {
		const ops = args[0] as unknown as Array<{ key: string }>
		calls.push({ db, keys: ops.map((o) => String(o.key)) })
	}

;(rocksState as unknown as { put: AnyFn }).put = ((...args: never[]) => {
	calls.push({ db: 'state', keys: [String(args[0])] })
	return origStatePut(...args)
}) as AnyFn
;(rocksState as unknown as { batch: AnyFn }).batch = ((...args: never[]) => {
	spyBatch('state')(...args)
	return origStateBatch(...args)
}) as AnyFn
;(rocksState as unknown as { del: AnyFn }).del = ((...args: never[]) => {
	calls.push({ db: 'state', keys: [String(args[0])] })
	return origStateDel(...args)
}) as AnyFn
;(rocksHistory as unknown as { put: AnyFn }).put = ((...args: never[]) => {
	calls.push({ db: 'history', keys: [String(args[0])] })
	return origHistoryPut(...args)
}) as AnyFn
;(rocksHistory as unknown as { batch: AnyFn }).batch = ((...args: never[]) => {
	spyBatch('history')(...args)
	return origHistoryBatch(...args)
}) as AnyFn
;(rocksBlock as unknown as { put: AnyFn }).put = ((...args: never[]) => {
	calls.push({ db: 'block', keys: [String(args[0])] })
	return origBlockPut(...args)
}) as AnyFn
;(rocksBlock as unknown as { batch: AnyFn }).batch = ((...args: never[]) => {
	spyBatch('block')(...args)
	return origBlockBatch(...args)
}) as AnyFn

const restoreSpies = (): void => {
	;(rocksState as unknown as { put: unknown }).put = origStatePut
	;(rocksState as unknown as { batch: unknown }).batch = origStateBatch
	;(rocksState as unknown as { del: unknown }).del = origStateDel
	;(rocksHistory as unknown as { put: unknown }).put = origHistoryPut
	;(rocksHistory as unknown as { batch: unknown }).batch = origHistoryBatch
	;(rocksBlock as unknown as { put: unknown }).put = origBlockPut
	;(rocksBlock as unknown as { batch: unknown }).batch = origBlockBatch
}

const { result: res1 } = await commitNext(MINER)
restoreSpies()

ok('commitBlock blok 1 sukses', res1.status === true)

const record1 = (await rocksJournal.get('journal:1')) as unknown as {
	height: number
	hash: string
	entries: Array<{ store: string; key: string }>
}
const written = new Set<string>()
for (const call of calls) {
	for (const key of call.keys) written.add(`${call.db}:${key}`)
}
const journaled = new Set<string>(
	record1.entries.map((entry) => `${entry.store}:${entry.key}`),
)
const noUndo = [...written].filter((k) => !journaled.has(k))
const neverWritten = [...journaled].filter((k) => !written.has(k))
ok(
	'setiap tulisan DB punya undo di journal (tak ada yang bocor)',
	noUndo.length === 0,
	`tanpa-undo=[${noUndo}]`,
)
ok(
	'journal tidak memuat kunci yang tak pernah ditulis',
	neverWritten.length === 0,
	`tak-ditulis=[${neverWritten}]`,
)
ok(
	'committed:<1> tertulis (blok permanen)',
	(await rocksJournal.get('committed:1')) === '1',
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

// Record yang hash-nya tidak cocok dengan rantai WAJIB ditolak: memulihkan
// nilai lama ke rantai yang salah merusak state lebih parah daripada tidak
// rollback.
{
	const tampered = { ...record1, hash: 'f'.repeat(64) }
	await rocksJournal.put('journal:1', tampered, { sync: true })
	const dumpBeforeTamper = await dumpAll()
	let rejected: unknown
	try {
		await journal.rollbackBlock(1)
	} catch (error) {
		rejected = error
	}
	ok(
		'rollback dengan hash salah DITOLAK',
		rejected instanceof Error && /tidak cocok/.test(rejected.message),
		rejected instanceof Error ? rejected.message : 'tidak melempar',
	)
	ok(
		'  → dan tidak ada satu kunci pun yang berubah',
		deepEqual(await dumpAll(), dumpBeforeTamper),
	)
	await rocksJournal.put('journal:1', record1, { sync: true })
}

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
// GROUP D — recovery boot (crash di tiap titik)
// ---------------------------------------------------------------------------
console.log('\nGROUP D — recovery boot (crash di tiap titik):')

// Bawa kembali ke tinggi 1 dulu supaya konteks bersih.
await journal.rollbackAbove(1)
const dumpStable = await dumpAll()

// D-1: crash SEBELUM WAL — buffer berisi tulisan, belum ada journal, belum
// ada flush. Tidak boleh ada yang perlu (atau bisa) dipulihkan.
{
	const crashAddr = `NxC${'77'.repeat(20)}`
	buf.beginWriteBuffer()
	await putAccount(crashAddr, balanceOf(crashAddr, 42))
	buf.discardWriteBuffer()
	ok(
		'crash sebelum WAL ⟹ tidak ada tulisan, tidak ada journal',
		deepEqual(await dumpAll(), dumpStable) &&
			!(await journal.listJournalHeights()).includes(2),
	)
	ok(
		'  → recoverJournal tidak membalik apa pun',
		(await journal.recoverJournal()) === 0,
	)
}

// D-2: crash SESUDAH WAL + flush, SEBELUM `committed`. Inilah jendela yang
// dulu tidak tertangani: state sudah maju, blok belum permanen.
{
	const template = await createBlockTemplate([], MINER)
	buf.beginWriteBuffer()
	await saveBlock(template)
	await processTransact(template.block.transactions, template.block)
	await journal.writeJournalRecord({
		height: template.block.height,
		hash: template.block.header.hash,
		entries: buf.bufferEntries(),
	})
	await buf.flushWriteBuffer()
	buf.discardWriteBuffer()

	ok(
		'simulasi: state sudah maju & journal ada, penanda belum',
		(await getBlockState())?.currentBlockHeight === 2,
		String((await getBlockState())?.currentBlockHeight),
	)
	const rolledCrash = await journal.recoverJournal()
	ok(
		'recoverJournal membalik blok tanpa penanda',
		rolledCrash === 1,
		`rolled=${rolledCrash}`,
	)
	ok(
		'state setelah recovery == sebelum crash',
		deepEqual(await dumpAll(), dumpStable),
	)
	ok(
		'journal yatim dibuang setelah recovery',
		!(await journal.listJournalHeights()).includes(2),
	)
	ok(
		'recoverJournal idempoten (panggilan kedua = 0)',
		(await journal.recoverJournal()) === 0,
	)
}

// D-3: commit penuh (dengan penanda) TIDAK boleh dibalik recovery.
{
	const { result } = await commitNext(MINER)
	ok('commit normal sukses', result.status === true)
	const dumpCommitted = await dumpAll()
	ok(
		'recoverJournal tidak membalik blok ber-penanda',
		(await journal.recoverJournal()) === 0,
	)
	ok('  → state tetap utuh', deepEqual(await dumpAll(), dumpCommitted))
	ok(
		'  → journal tetap disimpan (dibutuhkan reorg)',
		(await journal.listJournalHeights()).includes(2),
	)
}

// ---------------------------------------------------------------------------
// GROUP E — prune
// ---------------------------------------------------------------------------
console.log('\nGROUP E — prune MAX_REORG_DEPTH:')

ok('MAX_REORG_DEPTH = 128', journal.MAX_REORG_DEPTH === 128)

const fake = (h: number) => ({ height: h, hash: `fake${h}`, entries: [] })
for (const h of [5, 6, 7, 100]) {
	await rocksJournal.put(`journal:${h}`, fake(h), { sync: true })
}
await rocksJournal.put('committed:5', '1')
await rocksJournal.put('committed:100', '1')
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
ok(
	'penanda ikut dipangkas / dipertahankan sesuai record-nya',
	(await rocksJournal.get('committed:5')) === undefined &&
		(await rocksJournal.get('committed:100')) === '1',
)

// ---------------------------------------------------------------------------
// GROUP F — Fase 0: kegagalan tidak ditelan + commit terserialkan
// ---------------------------------------------------------------------------
console.log('\nGROUP F — Fase 0 (fail-closed + mutex commit):')

// F0.2: mutex commit global — tiga commit bersamaan tidak boleh tumpang tindih.
{
	const { withCommitLock } = await import('src/core/blockchain/commitLock')
	const order: string[] = []
	const run = (name: string) =>
		withCommitLock(async () => {
			order.push(`${name}:start`)
			await new Promise((resolve) => setTimeout(resolve, 5))
			order.push(`${name}:end`)
		})

	await Promise.all([run('a'), run('b'), run('c')])

	let depth = 0
	let maxDepth = 0
	for (const event of order) {
		depth += event.endsWith(':start') ? 1 : -1
		if (depth > maxDepth) maxDepth = depth
	}
	ok(
		'commit tidak tumpang tindih (maxDepth = 1)',
		maxDepth === 1,
		`max=${maxDepth}`,
	)
	ok('semua commit selesai (tidak ada yang hilang)', order.length === 6)
}

// F0.1: kegagalan eksekusi tx WAJIB melempar. Blok genesis dipakai sebagai
// wadah karena record hadiahnya sudah ada → `applyBlockReward` idempoten dan
// tidak menulis apa pun; yang diuji hanya jalur tx (pengirim tanpa saldo).
{
	const genesis = getGenesisBlock()
	const broke = {
		from: `NxC${'00'.repeat(20)}`,
		receiver: MINER,
		amount: 1,
		fee: 1,
		nonce: 0,
		txHash: `TxC${'0'.repeat(64)}`,
	} as unknown as Parameters<typeof processTransact>[0][number]

	let thrown: unknown
	try {
		await processTransact([broke], genesis.block)
	} catch (error) {
		thrown = error
	}
	ok(
		'tx gagal ⟹ processTransact MELEMPAR (commit wajib gagal)',
		thrown instanceof Error && /Insufficient balance/.test(thrown.message),
		thrown instanceof Error ? thrown.message : 'tidak melempar',
	)
}

// ---------------------------------------------------------------------------
// GROUP G — Fase 1a: leaf akun RLP v1 + timestamp blok
// ---------------------------------------------------------------------------
console.log('\nGROUP G — Fase 1a (leaf RLP + timestamp blok):')
{
	const { encodeAccount, decodeAccount, ACCOUNT_STATE_VERSION } =
		await import('src/core/encoding/rlp/accountCodec')
	const { rlpEncode } = await import('src/core/encoding/rlp/rlpEncode')
	const { numberToBytes, bytesToHex } =
		await import('src/core/encoding/rlp/codecScalars')
	const { stringToHex } = await import('src/core/encoding/hex/stringToHex')

	const sample = {
		address: MINER,
		balance: 12_345_678,
		transactionCount: 7,
		lastTransactionDate: 1_700_000_123_456,
		nonce: 3,
	}
	const back = decodeAccount(encodeAccount(sample), MINER)
	ok(
		'leaf RLP round-trip (nonce/balance/txCount/waktu)',
		back.nonce === 3 &&
			back.balance === 12_345_678 &&
			back.transactionCount === 7 &&
			back.lastTransactionDate === 1_700_000_123_456,
		JSON.stringify(back),
	)
	ok('address diambil dari KUNCI, bukan dari leaf', back.address === MINER)
	ok(
		'akun tanpa transaksi → lastTransactionDate null',
		decodeAccount(
			encodeAccount({ ...sample, lastTransactionDate: null }),
			MINER,
		).lastTransactionDate === null,
	)

	// Nilai JSON lama (sebelum v0.1) WAJIB ditolak, bukan dibaca sebagai saldo 0.
	let legacyRejected: unknown
	try {
		decodeAccount(stringToHex(JSON.stringify(sample)), MINER)
	} catch (error) {
		legacyRejected = error
	}
	ok(
		'nilai JSON lama DITOLAK (bukan saldo 0)',
		legacyRejected instanceof Error &&
			/NEX_DATA_DIR/.test(legacyRejected.message),
		legacyRejected instanceof Error ? legacyRejected.message : 'tidak melempar',
	)

	// Versi tak dikenal juga ditolak (fail-closed, bukan tebakan).
	const futureLeaf = `0x${bytesToHex(
		rlpEncode([
			numberToBytes(ACCOUNT_STATE_VERSION + 1, 'version', 'gate'),
			numberToBytes(0, 'nonce', 'gate'),
			numberToBytes(1, 'balance', 'gate'),
			numberToBytes(0, 'txCount', 'gate'),
			numberToBytes(0, 'lastTxTime', 'gate'),
		]),
	)}` as `0x${string}`
	let versionRejected: unknown
	try {
		decodeAccount(futureLeaf, MINER)
	} catch (error) {
		versionRejected = error
	}
	ok(
		'versi state tak dikenal DITOLAK',
		versionRejected instanceof Error && /versi/.test(versionRejected.message),
	)

	// Determinisme: `lastTransactionDate` = timestamp BLOK, bukan `Date.now()`.
	const TS = 1_600_000_000_000
	const DET = `NxC${'ee'.repeat(20)}`
	await processReceiver(DET, 1, TS)
	const det = await getAccount(DET)
	ok(
		'lastTransactionDate = timestamp blok (deterministik antar-node)',
		det?.lastTransactionDate === TS,
		String(det?.lastTransactionDate),
	)
	ok('  → dan saldo bertahan lewat leaf RLP', det?.balance === 1)
}

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
