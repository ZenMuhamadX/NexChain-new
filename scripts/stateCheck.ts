/**
 * Gerbang regresi "state commitment (v0.1 / Fase 1c)".
 *
 * Jalankan:  bun run check:state
 *
 * Yang dibuktikan:
 *
 *   A. **Template == commit** — `createBlockTemplate` mendapatkan `stateRoot`
 *      dari EKSEKUSI nyata, dan `commitBlock` menerima blok itu; blok dengan
 *      `stateRoot` yang diubah DITOLAK dan tip tidak bergerak.
 *   B. **Replay** — `replayState()` membangun ulang state dari genesis dan
 *      mencocokkan root tiap blok. Nol tulisan ke DB (dibuktikan dengan spy).
 *   C. **Tamper terdeteksi** — mengubah satu saldo di DB (di luar eksekusi)
 *      membuat replay menolak, dan memulihkan nilai aslinya membuatnya lulus
 *      lagi. Inilah bukti "boot menolak state yang diubah tangan".
 *   D. **`--rebuild-state`** — state hasil replay ditulis kembali: saldo palsu
 *      hilang, akun liar dihapus, dan verifikasi lulus setelahnya.
 *   E. **Invariant** — Σ saldo di DB == `blockState.totalIssued` == Σ hadiah
 *      blok. Ini yang menutup bug pencetakan/pembakaran yang tidak terdeteksi
 *      root (mis. transfer tanpa debit).
 *
 * Memakai `NEX_DATA_DIR` sementara (LevelDB nyata, dibuang setelahnya).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HexString } from 'src/types/block'

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-state-'))
process.env.NEX_DATA_DIR = tmpDir

const { rocksState } = await import('src/core/state/db/state')
const { rocksHistory } = await import('src/core/state/db/history')
const { rocksBlock } = await import('src/core/state/db/block')
const { rocksJournal } = await import('src/core/state/db/journal')
const { getGenesisBlock } = await import('src/core/block/genesis')
const { saveBlock } = await import('src/core/state/storage/block/saveBlock')
const { getBlockState } = await import('src/core/state/storage/state/getState')
const { getAccount } = await import('src/core/state/account/getAccount')
const { putAccount } = await import('src/core/state/account/putAccount')
const { chains } = await import('src/core/block/initBlock')
const { createBlockTemplate } =
	await import('src/core/block/createBlockTemplate')
const { getBlockByHeight } =
	await import('src/core/block/query/onChain/block/getBlockByHeight')
const { cutBlockReward } = await import('src/core/block/distributeBlockReward')
const { replayState } = await import('src/core/consensus/verify/verifyState')
const { decodeAccount } = await import('src/core/encoding/rlp/accountCodec')
const { getHistoryByAddress } =
	await import('src/core/block/query/onChain/Transaction/getHistoryByAddress')
const { EMPTY_STATE_ROOT, computeStateRoot } =
	await import('src/core/state/root')

await rocksState.open()
await rocksHistory.open()
await rocksBlock.open()
await rocksJournal.open()

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

const MINER = `NxC${'cc'.repeat(20)}`
const RECEIVER = `NxC${'dd'.repeat(20)}`
const hex64 = (n: number): string => n.toString(16).padStart(64, '0')

let fakeHash = 0x2000
/** Commit template dengan hash unik — PoW tidak diperiksa `commitBlock`. */
const commit = async (
	tpl: Awaited<ReturnType<typeof createBlockTemplate>>,
): Promise<boolean> => {
	tpl.block.header.hash = hex64(fakeHash++)
	return (await chains.commitBlock(tpl)).status
}

/** Tx mainan (tanda tangan palsu — `commitBlock` tidak memeriksanya). */
const makeTx = (
	from: string,
	nonce: number,
	amount: number,
	fee: number,
	tag: string,
) =>
	({
		nonce,
		fee,
		receiver: RECEIVER,
		amount,
		from,
		txHash: `TxC${'0'.repeat(60)}${tag.length}${tag.slice(-3)}`,
		sign: { v: 27, r: '01'.repeat(32), s: '02'.repeat(32) },
	}) as never

const balanceOf = async (address: string): Promise<number> =>
	(await getAccount(address))?.balance ?? -1

/** Nilai mentah leaf (nilai state = `0x<hex(RLP)>`); `undefined` bila tak ada. */
const rawLeaf = async (address: string): Promise<HexString> =>
	(await rocksState.get(address)) as HexString

const tip = async (): Promise<number> =>
	(await getBlockState())?.currentBlockHeight ?? -1

// ---------------------------------------------------------------------------
// bootstrap genesis (jalur yang sama dengan server.ts: TANPA akun)
// ---------------------------------------------------------------------------
{
	const genesis = getGenesisBlock()
	ok('genesis tersimpan (state kosong)', (await saveBlock(genesis)) === true)
	ok(
		'stateRoot genesis = root kosong',
		genesis.block.header.stateRoot === EMPTY_STATE_ROOT,
		genesis.block.header.stateRoot,
	)
}

// ---------------------------------------------------------------------------
// GROUP A — template == commit
// ---------------------------------------------------------------------------
console.log('\nGROUP A — stateRoot dari eksekusi nyata:')

const R1 = cutBlockReward(1)
const block1 = await createBlockTemplate([], MINER)
ok(
	'template blok 1 ber-stateRoot 64 hex',
	/^[0-9a-f]{64}$/.test(block1.block.header.stateRoot),
	block1.block.header.stateRoot,
)
ok(
	'template root BUKAN root kosong (hadiah mengkredit penambang)',
	block1.block.header.stateRoot !== EMPTY_STATE_ROOT,
	block1.block.header.stateRoot,
)
ok('commit blok 1 (root dari template)', await commit(block1))
ok(
	'saldo penambang = hadiah blok 1 (dibayar lewat eksekusi)',
	(await balanceOf(MINER)) === R1,
	`${await balanceOf(MINER)} != ${R1}`,
)

// Blok 2 MEMBAYAR: tx dari penambang (yang baru punya saldo) ke RECEIVER.
const AMOUNT = 100_000_000
const FEE = 1_000_000
const block2 = await createBlockTemplate(
	[makeTx(MINER, 0, AMOUNT, FEE, 'a1')],
	MINER,
)
ok('commit blok 2 (dengan transfer nyata)', await commit(block2))
ok(
	'transfer terdebit (fee kembali ke penambang: ia pengirim DAN penambang)',
	(await balanceOf(MINER)) === R1 + cutBlockReward(2) - AMOUNT,
	`${await balanceOf(MINER)}`,
)
ok('penerima menerima amount', (await balanceOf(RECEIVER)) === AMOUNT)

// Reproduksi akumulator di luar mesin: root blok 2 hanya bergantung pada root
// blok 1 + leaf yang disentuh blok 2 (bukan seluruh state).
{
	const expected = computeStateRoot(block1.block.header.stateRoot, [
		{ address: MINER, value: await rawLeaf(MINER) },
		{ address: RECEIVER, value: await rawLeaf(RECEIVER) },
	])
	ok(
		'root blok 2 == akumulator(root 1, leaf yang disentuh blok 2)',
		expected === block2.block.header.stateRoot,
		`${expected} != ${block2.block.header.stateRoot}`,
	)
}

const block3 = await createBlockTemplate(
	[makeTx(RECEIVER, 0, 10, 1, 'b2')],
	MINER,
)
ok('commit blok 3 (penerima membelanjakan)', await commit(block3))

// Blok dengan root diubah WAJIB ditolak, dan tidak boleh menggeser tip.
{
	const before = await tip()
	const bad = await createBlockTemplate([], MINER)
	bad.block.header.stateRoot = hex64(0xdead)
	ok('blok dengan stateRoot salah DITOLAK', (await commit(bad)) === false)
	ok('  → tip tidak bergerak', (await tip()) === before)
	ok(
		'  → tidak ada journal tertinggal untuk blok itu',
		!(await rocksJournal.get(`journal:${before + 1}`).catch(() => null)),
	)
}

// ---------------------------------------------------------------------------
// GROUP B — replay (verifikasi, nol tulis)
// ---------------------------------------------------------------------------
console.log('\nGROUP B — replay genesis→tip:')

type AnyFn = (...args: unknown[]) => Promise<unknown>
const origStateBatch = rocksState.batch.bind(rocksState) as unknown as AnyFn
const origStatePut = rocksState.put.bind(rocksState) as unknown as AnyFn
let writes = 0
;(rocksState as unknown as { batch: AnyFn }).batch = (...args) => {
	writes++
	return origStateBatch(...args)
}
;(rocksState as unknown as { put: AnyFn }).put = (...args) => {
	writes++
	return origStatePut(...args)
}

const replay = await replayState(false)

;(rocksState as unknown as { batch: unknown }).batch = origStateBatch
;(rocksState as unknown as { put: unknown }).put = origStatePut

ok('replay lulus', replay.ok, replay.reason ?? '')
ok(
	'  → berhenti di tip',
	replay.height === (await tip()),
	String(replay.height),
)
ok(
	'  → root replay == root header tip',
	replay.root === block3.block.header.stateRoot,
	`${replay.root} != ${block3.block.header.stateRoot}`,
)
ok('  → verifikasi TIDAK menulis DB', writes === 0, `writes=${writes}`)

// ---------------------------------------------------------------------------
// GROUP C — tamper satu saldo
// ---------------------------------------------------------------------------
console.log('\nGROUP C — satu saldo diubah di DB:')

const realLeaf = await rawLeaf(MINER)
const realBalance = decodeAccount(realLeaf, MINER).balance
{
	await rocksState.put(
		MINER,
		// Saldo +1 nexu: cukup untuk menggeser root, tanpa merusak bentuk leaf.
		(await import('src/core/encoding/rlp/accountCodec')).encodeAccount({
			...decodeAccount(realLeaf, MINER),
			balance: realBalance + 1,
		}),
	)
	const tampered = await replayState(false)
	ok('replay MENOLAK state yang diubah', !tampered.ok, tampered.reason ?? '')
	ok(
		'  → alasan menyebut stateRoot',
		/stateRoot/.test(tampered.reason ?? ''),
		tampered.reason ?? '',
	)
	ok(
		'  → node tetap melaporkan tip lama (verifikasi tidak "memperbaiki" diam-diam)',
		(await tip()) === 3,
	)

	await rocksState.put(MINER, realLeaf)
	const restored = await replayState(false)
	ok(
		'nilai asli dikembalikan → replay lulus lagi',
		restored.ok,
		restored.reason ?? '',
	)
}

// ---------------------------------------------------------------------------
// GROUP D — rebuild state
// ---------------------------------------------------------------------------
console.log('\nGROUP D — --rebuild-state:')

const LOST = `NxC${'ee'.repeat(20)}`
{
	// Rusak dua hal sekaligus: saldo yang diubah + akun liar yang tidak pernah
	// dihasilkan rantai.
	await rocksState.put(
		MINER,
		(await import('src/core/encoding/rlp/accountCodec')).encodeAccount({
			...decodeAccount(realLeaf, MINER),
			balance: realBalance + 5,
		}),
	)
	await putAccount(LOST, {
		address: LOST,
		balance: 7,
		transactionCount: 0,
		lastTransactionDate: 1,
		nonce: 0,
	})
	ok('replay menolak sebelum rebuild', !(await replayState(false)).ok)

	const rebuilt = await replayState(true)
	ok('rebuild membangun ulang state', rebuilt.ok, rebuilt.reason ?? '')
	ok(
		'  → saldo penambang kembali sesuai rantai',
		(await balanceOf(MINER)) === realBalance,
		`${await balanceOf(MINER)} != ${realBalance}`,
	)
	ok('  → akun liar DIHAPUS', (await rawLeaf(LOST)) === undefined)
	ok('  → verifikasi lulus setelah rebuild', (await replayState(false)).ok)
}

// ---------------------------------------------------------------------------
// GROUP E — invariant Σ saldo == totalIssued
// ---------------------------------------------------------------------------
console.log('\nGROUP E — invariant suplai:')

{
	let sum = 0
	let accounts = 0
	for await (const [key, value] of rocksState.iterator()) {
		const name = String(key)
		if (name === 'blockState' || name.startsWith('blockHeight:')) continue
		sum += decodeAccount(String(value) as HexString, name).balance
		accounts++
	}

	let issued = 0
	for (let h = 0; h <= (await tip()); h++) {
		const block = (await getBlockByHeight(h)) as
			Awaited<ReturnType<typeof getBlockByHeight>> | undefined
		issued += block!.block.blockReward
	}
	const state = await getBlockState()
	ok('Σ saldo == Σ hadiah blok', sum === issued, `Σ=${sum} hadiah=${issued}`)
	ok(
		'Σ saldo == blockState.totalIssued',
		sum === state?.totalIssued,
		`Σ=${sum} totalIssued=${state?.totalIssued}`,
	)
	ok(
		'ada 2 akun (penambang + penerima)',
		accounts === 2,
		`accounts=${accounts}`,
	)
}

// ---------------------------------------------------------------------------
// GROUP F — indeks alamat per-entri (1d)
// ---------------------------------------------------------------------------
console.log('\nGROUP F — indeks alamat per-entri:')

/** Entri indeks mentah satu alamat (urutan key = urutan rantai). */
const indexEntries = async (
	address: string,
): Promise<Array<{ txHash: string; height: number; dir: string }>> => {
	const prefix = `addr:${address}:`
	const out: Array<{ txHash: string; height: number; dir: string }> = []
	for await (const [key, value] of rocksHistory.iterator({
		gte: prefix,
		lt: `${prefix.slice(0, -1)};`,
	})) {
		const [height, txHash] = String(key).slice(prefix.length).split(':')
		out.push({ txHash, height: Number(height), dir: String(value) })
	}
	return out
}

{
	// Rantai GROUP A: setiap blok membayar MINER, blok 2 juga memuat transfer
	// MINER → RECEIVER, blok 3 transfer RECEIVER → RECEIVER (self).
	const minerIdx = await indexEntries(MINER)
	ok(
		'key penambang ber-`addr:<alamat>:<tinggi>` dan tinggi menaik',
		minerIdx.length > 0 &&
			minerIdx.every(
				(entry, i) => i === 0 || entry.height >= minerIdx[i - 1].height,
			),
		JSON.stringify(minerIdx.map((entry) => `${entry.height}${entry.dir}`)),
	)
	ok(
		'hadiah tiap blok tercatat `in`; transfer keluar `out` di tingginya',
		minerIdx.filter((entry) => entry.dir === 'out').length === 1 &&
			minerIdx.some((entry) => entry.dir === 'out' && entry.height === 2) &&
			minerIdx.some((entry) => entry.dir === 'in' && entry.height === 1),
		JSON.stringify(minerIdx.filter((entry) => entry.dir !== 'in')),
	)

	const recIdx = await indexEntries(RECEIVER)
	ok(
		'penerima: `in` h2 + `self` h3 (satu entri per tx, bukan dua)',
		recIdx.length === 2 && recIdx[0].dir === 'in' && recIdx[1].dir === 'self',
		JSON.stringify(recIdx),
	)

	const { history, count } = await getHistoryByAddress(MINER)
	ok(
		'riwayat = indeks dibalik (blok terbaru dulu)',
		count === minerIdx.length &&
			history.map((tx) => tx.txHash).join(',') ===
				minerIdx
					.map((entry) => entry.txHash)
					.reverse()
					.join(','),
		`${count}`,
	)

	let legacy = 0
	let coinbaseEntry = 0
	for await (const [key] of rocksHistory.iterator()) {
		const name = String(key)
		if (name.startsWith('address:')) legacy++
		if (name.startsWith('addr:COINBASE:')) coinbaseEntry++
	}
	ok('tidak ada lagi array lama `address:<alamat>`', legacy === 0, `${legacy}`)
	ok(
		'hadiah blok tidak membuat entri untuk `COINBASE` (bukan alamat)',
		coinbaseEntry === 0,
		`${coinbaseEntry}`,
	)
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
for (const db of [rocksState, rocksHistory, rocksBlock, rocksJournal]) {
	await db.close().catch(() => undefined)
}
try {
	fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {
	console.log(`  (catatan) tidak bisa menghapus ${tmpDir} — dilewati`)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
