/**
 * Gerbang regresi "reorg (M2)".
 *
 * Jalankan:  bun run check:reorg
 *
 * Membuktikan fondasi reorg (lihat `journal-difficulty-design.md` Bagian C):
 *
 *   1. **Fork choice MURNI** — `difficultyToWork` monoton & tepat ×2 per bit,
 *      `sumWork`, `compareWork`. Tanpa LevelDB.
 *   2. **Branch pool** — tambah/ambil/pangkas + batas `MAX_POOL_BLOCKS`
 *      (entri height terendah dibuang lebih dulu).
 *   3. **Penelusuran nenek moyang bersama** — `traceBranchToLocal` menemukan
 *      `forkHeight`, menolak cabang tak tersambung.
 *   4. **Reorg penuh** — cabang lebih berat menang: rollback journal +
 *      replay senyap + tip/state/saldo benar (setara rantai segar satu node).
 *   5. **Cabang tidak lebih berat** — tip TIDAK berubah.
 *   6. **Batas kedalaman** — `MAX_REORG_DEPTH` ditolak dengan pesan jelas.
 *   7. **`invalidateFrom` (R-1)** — membuang state turunan >= height.
 *
 * Memakai `NEX_DATA_DIR` sementara (LevelDB nyata, dibuang setelahnya).
 * Modul DB diimpor SESUDAH env diset.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { blockStruct } from 'src/types/block'

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

// ---------------------------------------------------------------------------
// DB temp + impor dinamis (env harus diset SEBELUM modul DB diimpor)
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-reorg-'))
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
const { chains } = await import('src/core/block/initBlock')
const { Block } = await import('src/core/block/blockModel')
const { createBlockTemplate } =
	await import('src/core/block/createBlockTemplate')
const { cutBlockReward } = await import('src/core/block/distributeBlockReward')
const { CHAIN_ID } = await import('src/crypto/chainId')
const forkChoice = await import('src/core/consensus/reorg/forkChoice')
const pool = await import('src/core/consensus/reorg/branchPool')
const ancestry = await import('src/core/consensus/reorg/ancestry')
const reorg = await import('src/core/consensus/reorg/reorg')
const journal = await import('src/core/state/journal/store')
const sync = await import('src/core/events/syncState')

await rocksState.open()
await rocksHistory.open()
await rocksBlock.open()
await rocksJournal.open()

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

const MINER_A = `NxC${'ab'.repeat(20)}`
const MINER_B = `NxC${'cd'.repeat(20)}`

const hex64 = (n: number): string => n.toString(16).padStart(64, '0')

const balanceOf = (address: string, balance: number) => ({
	address,
	balance,
	transactionCount: 1,
	isContract: false,
	lastTransactionDate: 1_700_000_000_000,
	nonce: 0,
})

/** Blok ringan untuk uji pool (tak pernah di-commit). */
const fakeBlock = (
	height: number,
	hash: string,
	prevHash: string,
	difficulty = 20,
): InstanceType<typeof Block> =>
	new Block({
		header: {
			difficulty,
			hash,
			nonce: 0,
			previousBlockHash: prevHash,
			timestamp: 1_700_000_000_000 + height,
			version: '1.0.0',
			hashingAlgorithm: 'SHA256',
		},
		blockReward: 0,
		totalTransactionFees: 0,
		totalReward: 0,
		height,
		merkleRoot: '0'.repeat(64),
		minerId: MINER_A,
		chainId: CHAIN_ID,
		size: 0,
		status: 'confirmed',
		coinbaseTransaction: { amount: 0, receiver: MINER_A, extraData: '0x' },
		metadata: { created_at: 0, txCount: 0, extraData: '0x' },
		transactions: [],
	} as unknown as blockStruct)

/** Commit template dengan hash unik (commitBlock tidak memeriksa hash/PoW). */
const commit = async (
	block: InstanceType<typeof Block>,
	hash: string,
): Promise<boolean> => {
	block.block.header.hash = hash
	return (await chains.commitBlock(block)).status
}

const tipHeight = async (): Promise<number | undefined> =>
	(await getBlockState())?.currentBlockHeight

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
// GROUP 1 — fork choice murni
// ---------------------------------------------------------------------------
console.log('\nGROUP 1 — fork choice murni:')

ok(
	'difficultyToWork monoton naik',
	forkChoice.difficultyToWork(20) < forkChoice.difficultyToWork(20.25) &&
		forkChoice.difficultyToWork(20.25) < forkChoice.difficultyToWork(21),
)
ok(
	'0.25 bit = ×2 kerja (20.25 vs 20)',
	forkChoice.difficultyToWork(20.25) === forkChoice.difficultyToWork(20) * 2n,
)
ok(
	'1 bit = ×16 kerja (21 vs 20)',
	forkChoice.difficultyToWork(21) === forkChoice.difficultyToWork(20) * 16n,
)
ok('difficultyToWork(0) minimal 1n', forkChoice.difficultyToWork(0) === 1n)
ok(
	'sumWork = jumlah kerja tiap blok',
	(() => {
		const b1 = fakeBlock(1, hex64(101), hex64(1), 20)
		const b2 = fakeBlock(2, hex64(102), hex64(101), 21)
		return (
			forkChoice.sumWork([b1, b2]) ===
			forkChoice.blockWork(b1) + forkChoice.blockWork(b2)
		)
	})(),
)
ok(
	'compareWork',
	forkChoice.compareWork(1n, 2n) === -1 &&
		forkChoice.compareWork(2n, 2n) === 0 &&
		forkChoice.compareWork(3n, 2n) === 1,
)

// ---------------------------------------------------------------------------
// GROUP 2 — branch pool
// ---------------------------------------------------------------------------
console.log('\nGROUP 2 — branch pool:')

pool.resetBranchPool()
ok('pool awalnya kosong', pool.poolSize() === 0)

const pb1 = fakeBlock(5, hex64(201), hex64(200))
const pb2 = fakeBlock(6, hex64(202), hex64(201))
pool.addToPool(pb1)
pool.addToPool(pb2)
ok('addToPool + poolSize', pool.poolSize() === 2)
ok('getPooled mengembalikan entri', pool.getPooled(hex64(201))?.height === 5)
pool.addToPool(pb1)
ok('addToPool idempoten (hash sama tidak menggandakan)', pool.poolSize() === 2)
ok('removePooled', pool.removePooled(hex64(202)) && pool.poolSize() === 1)
ok('removePooled hash tak ada → false', pool.removePooled(hex64(999)) === false)

pool.resetBranchPool()
for (let h = 0; h < pool.MAX_POOL_BLOCKS + 5; h++) {
	pool.addToPool(fakeBlock(h, hex64(1000 + h), hex64(1000 + h - 1)))
}
ok(
	`pool dibatasi MAX_POOL_BLOCKS (${pool.MAX_POOL_BLOCKS})`,
	pool.poolSize() === pool.MAX_POOL_BLOCKS,
	`size=${pool.poolSize()}`,
)
ok(
	'eviction membuang height TERENDAH',
	!pool.hasPooled(hex64(1000)) && pool.hasPooled(hex64(1000 + pool.MAX_POOL_BLOCKS + 4)),
)

pool.resetBranchPool()
pool.addToPool(fakeBlock(3, hex64(301), hex64(300)))
pool.addToPool(fakeBlock(4, hex64(302), hex64(301)))
pool.addToPool(fakeBlock(5, hex64(303), hex64(302)))
ok('prunePoolAtOrBelow', pool.prunePoolAtOrBelow(4) === 2 && pool.poolSize() === 1)
pool.resetBranchPool()
pool.addToPool(fakeBlock(3, hex64(401), hex64(400)))
pool.addToPool(fakeBlock(4, hex64(402), hex64(401)))
pool.addToPool(fakeBlock(5, hex64(403), hex64(402)))
ok(
	'prunePoolAtOrAbove',
	pool.prunePoolAtOrAbove(4) === 2 && pool.poolSize() === 1,
)

// ---------------------------------------------------------------------------
// GROUP 3 — penelusuran + reorg penuh (cabang lebih berat menang)
// ---------------------------------------------------------------------------
console.log('\nGROUP 3 — reorg penuh:')

pool.resetBranchPool()
sync.resetSyncState()

const h1 = hex64(1)
const block1 = await createBlockTemplate([], MINER_A)
ok('commit blok 1 (miner A)', await commit(block1, h1))

// Cabang lokal: blok 2a (miner A) di atas blok 1.
const h2a = hex64(2)
const block2a = await createBlockTemplate([], MINER_A)
ok('commit blok 2a (miner A)', await commit(block2a, h2a))
ok('tip lokal = 2', (await tipHeight()) === 2)

// Cabang saingan dari blok 1: 2b (miner B) -> 3b (miner B). Belum di-commit.
const h2b = hex64(0xb)
const h3b = hex64(0xc)
const block2b = await createBlockTemplate([], MINER_B, block1)
block2b.block.header.hash = h2b
const block3b = await createBlockTemplate([], MINER_B, block2b)
block3b.block.header.hash = h3b

pool.addToPool(block2b)
pool.addToPool(block3b)

ok(
	'trace cabang tersambung (fork di height 1)',
	(await ancestry.traceBranchToLocal(h3b))?.forkHeight === 1,
)
ok(
	'trace cabang tak tersambung → undefined',
	(await ancestry.traceBranchToLocal(hex64(0xdead))) === undefined,
)

const reorgResult = await reorg.reevaluateBranches()

ok('reevaluateBranches melakukan reorg', reorgResult.status === true)
ok('forkHeight = 1', reorgResult.forkHeight === 1)
ok('tip baru = 3', reorgResult.newHeight === 3)
ok('1 blok lokal dibalik', reorgResult.rolledBack === 1)

const stateAfter = await getBlockState()
ok('blockState.currentBlockHeight = 3', stateAfter?.currentBlockHeight === 3)
ok('blockState.currentBlockHash = 3b', stateAfter?.currentBlockHash === h3b)
ok('tip lokal = 3', (await tipHeight()) === 3)

const accA = (await getAccount(MINER_A))?.balance ?? 0
const accB = (await getAccount(MINER_B))?.balance ?? 0
ok(
	'saldo A = hadiah blok 1 saja (2a dibalik)',
	accA === cutBlockReward(1),
	`A=${accA} expected=${cutBlockReward(1)}`,
)
ok(
	'saldo B = hadiah blok 2 + 3 (setara rantai segar)',
	accB === cutBlockReward(2) + cutBlockReward(3),
	`B=${accB} expected=${cutBlockReward(2) + cutBlockReward(3)}`,
)

const heights = await journal.listJournalHeights()
ok(
	'journal berisi 1,2,3 setelah replay',
	heights.includes(1) && heights.includes(2) && heights.includes(3),
	heights.join(','),
)
ok('pool dibersihkan setelah reorg', pool.poolSize() === 0)
ok('fase sync kembali "synced"', sync.getSyncStatus().phase === 'synced')

// ---------------------------------------------------------------------------
// GROUP 4 — cabang tidak lebih berat: tip tidak berubah
// ---------------------------------------------------------------------------
console.log('\nGROUP 4 — cabang tidak lebih berat:')

const h2c = hex64(0xd)
const block2c = await createBlockTemplate([], MINER_B, block1)
block2c.block.header.hash = h2c
pool.addToPool(block2c)
const weaker = await reorg.reevaluateBranches()
ok('reevaluateBranches tidak reorg (cabang lebih ringan)', weaker.status === false)
ok(
	'tip tetap 3b',
	(await getBlockState())?.currentBlockHash === h3b,
)
ok(
	'onCompetingTip hash tak tersambung → gagal',
	(await reorg.onCompetingTip(hex64(0xfeed))).status === false,
)

// ---------------------------------------------------------------------------
// GROUP 5 — batas kedalaman MAX_REORG_DEPTH
// ---------------------------------------------------------------------------
console.log('\nGROUP 5 — batas kedalaman:')

const target = journal.MAX_REORG_DEPTH + 2 // tip harus > MAX_REORG_DEPTH
let h = (await tipHeight()) ?? 0
while (h < target) {
	const tpl = await createBlockTemplate([], MINER_A)
	const committed = await commit(tpl, hex64(5000 + h))
	if (!committed) {
		ok(`commit ekor blok height ${h + 1}`, false)
		break
	}
	h++
}
ok(`menambah blok sampai height ${target}`, (await tipHeight()) === target)

const tipNow = (await tipHeight()) ?? 0
const tooDeep = await reorg.switchToBranch(
	[fakeBlock(tipNow - journal.MAX_REORG_DEPTH, hex64(9001), hex64(9000))],
	0, // depth = tipNow - 0 = tipNow > 128
)
ok('reorg terlalu dalam ditolak', tooDeep.status === false)
ok(
	'pesan menyebut MAX_REORG_DEPTH',
	(tooDeep.reason ?? '').includes('MAX_REORG_DEPTH'),
	tooDeep.reason ?? '',
)

// ---------------------------------------------------------------------------
// GROUP 6 — invalidateFrom (R-1)
// ---------------------------------------------------------------------------
console.log('\nGROUP 6 — invalidateFrom (R-1):')

pool.resetBranchPool()
pool.addToPool(fakeBlock(5, hex64(6001), hex64(6000)))
pool.addToPool(fakeBlock(6, hex64(6002), hex64(6001)))
pool.addToPool(fakeBlock(7, hex64(6003), hex64(6002)))
ok('invalidateFrom(6) membuang height >= 6', reorg.invalidateFrom(6) === 2)
ok('tinggal height 5', pool.poolSize() === 1 && pool.hasPooled(hex64(6001)))

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
reorg.resetReorgState()
sync.resetSyncState()
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
