/**
 * Gerbang regresi "urutan nonce per-pengirim".
 *
 * Jalankan:  bun run check:nonce-order
 *
 * Membuktikan dua hal yang saling melengkapi:
 *
 *   1. **Template bebas-gap (work.ts)** — `selectGapFreeTransactions`
 *      mengelompokkan tx per `from` dan tiap pengirim hanya menyumbang
 *      larian KONTIGU mulai dari `account.nonce`-nya (diurut menaik).
 *      Tx di atas lubang dibuang dari template (tetap di mempool).
 *   2. **Pra-penerbangan validator (commitBlock)** — `verifyBlockNonceOrder`
 *      MENOLAK blok berisi tx nonce-lompat/acak SEBELUM tulisan WAL/state
 *      (penolakan bersih: saldo/nonce tak berubah), sambil menoleransi
 *      duplikat yang sudah dieksekusi (residu crash) tanpa crash.
 *   3. **Klasifikasi P2P (connectBlock, GROUP 5)** — blok yang menempel ke
 *      tip tetapi nonce-nya rusak DITOLAK dengan `{ ok:false, fatal:true }`
 *      (peer layak ban) lewat pra-penerbangan eksplisit di jalur cepat —
 *      diuji ujung-ke-ujung dengan satu blok PoW NYATA yang ditambang di
 *      dalam gate (lihat catatan posisi GROUP 5).
 *
 * Memakai `NEX_DATA_DIR` sementara (LevelDB nyata, dibuang setelahnya).
 * Modul DB diimpor SESUDAH env diset. `commitBlock` tidak memverifikasi
 * PoW maupun hash blok, jadi hash palsu-tetapi-konsisten dapat dipakai
 * (pola yang sama dengan `scripts/reorgCheck.ts`).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TxInterface } from 'src/types/transaction'
import type { Block } from 'src/core/block/blockModel'

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-nonce-'))
process.env.NEX_DATA_DIR = tmpDir

const { rocksState } = await import('src/core/state/db/state')
const { rocksHistory } = await import('src/core/state/db/history')
const { rocksBlock } = await import('src/core/state/db/block')
const { rocksJournal } = await import('src/core/state/db/journal')
const { rocksMempool } = await import('src/core/state/db/memPool')
const { getGenesisBlock } = await import('src/core/block/genesis')
const { putAccount } = await import('src/core/state/account/putAccount')
const { getAccount } = await import('src/core/state/account/getAccount')
const { saveBlock } = await import('src/core/state/storage/block/saveBlock')
const { saveMempool } =
	await import('src/core/state/storage/mempool/saveMemPool')
const { chains } = await import('src/core/block/initBlock')
const { createBlockTemplate } =
	await import('src/core/block/createBlockTemplate')
const { MemPool } = await import('src/core/transaction/memPool')
const { selectGapFreeTransactions } = await import('src/core/consensus/work')
const { verifyBlockNonceOrder, isNonceMismatchError } =
	await import('src/core/consensus/verify/module/verifyNonce')

await rocksState.open()
await rocksHistory.open()
await rocksBlock.open()
await rocksJournal.open()
await rocksMempool.open()

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

const SENDER_T1 = `NxC${'a1'.repeat(20)}`
const SENDER_T2 = `NxC${'b2'.repeat(20)}`
const SENDER_T3 = `NxC${'c3'.repeat(20)}`
const SENDER_T4A = `NxC${'d4'.repeat(20)}`
const SENDER_T4B = `NxC${'e5'.repeat(20)}`
const SENDER_T5 = `NxC${'f6'.repeat(20)}`
const SENDER_T6 = `NxC${'a7'.repeat(20)}`
const MINER = `NxC${'cc'.repeat(20)}`
const RECEIVER = `NxC${'dd'.repeat(20)}`

const hex64 = (n: number): string => n.toString(16).padStart(64, '0')

const FUND = 1_000_000_000

const fund = async (address: string): Promise<void> => {
	await putAccount(address, {
		address,
		balance: FUND,
		transactionCount: 0,
		isContract: false,
		lastTransactionDate: 1_700_000_000_000,
		nonce: 0,
	})
}

/** Tx mainan (tanda tangan palsu — `commitBlock` tak memeriksa tanda). */
const makeTx = (
	from: string,
	nonce: number,
	tag: string,
	amount = 10,
	fee = 1,
): TxInterface =>
	({
		nonce,
		fee,
		receiver: RECEIVER,
		amount,
		from,
		txHash: `nonce-order-${from.slice(-6)}-${tag}-${nonce}`,
		sign: { v: 27, r: '0x01', s: '0x01' },
	}) as TxInterface

let fakeHashCounter = 0x1000
/** Commit template dengan hash unik (PoW/hash tak diperiksa commitBlock). */
const commitTxs = async (txs: TxInterface[]): Promise<boolean> => {
	const tpl = await createBlockTemplate(txs, MINER)
	tpl.block.header.hash = hex64(fakeHashCounter++)
	return (await chains.commitBlock(tpl)).status
}

const snapshot = async (address: string) => {
	const acc = await getAccount(address)
	return { balance: acc?.balance ?? -1, nonce: acc?.nonce ?? -1 }
}

// ---------------------------------------------------------------------------
// bootstrap genesis (jalur yang sama dengan server.ts)
// ---------------------------------------------------------------------------

{
	const genesis = getGenesisBlock()
	const receiver = genesis.block.coinbaseTransaction.receiver
	await putAccount(receiver, {
		address: receiver,
		balance: genesis.block.coinbaseTransaction.amount,
		transactionCount: 1,
		isContract: false,
		lastTransactionDate: 1_700_000_000_000,
		nonce: 0,
	})
	const saved = await saveBlock(genesis)
	ok('bootstrap genesis tersimpan', saved === true)
}

// ---------------------------------------------------------------------------
// GROUP 5 — klasifikasi P2P: NonceMismatchError di jalur cepat = fatal (ban)
// ---------------------------------------------------------------------------
// Posisi DISENGAJA: tepat setelah bootstrap, di atas tip genesis (height 1,
// difficulty 20). `connectBlock` jalur cepat mensyaratkan PoW + hash blok
// NYATA (hash palsu seperti `commitTxs` gugur di `verifyPow`), sehingga gate
// menambang satu blok sungguhan — hanya layak pada difficulty 20 (~2^20
// hash, beberapa detik). Blok DITOLAK sehingga tip tak berubah dan GROUP
// 1–4 di bawah tak terpengaruh. Ini asersi ujung-ke-ujung sungguhan lewat
// titik masuk `connectBlock(raw: unknown)` yang diekspor
// (`src/p2p/validation/connectBlock.ts`), BUKAN pemetaan tiruan: asersi
// `alasan menyebut nonce` menjamin penolakan terjadi di pra-penerbangan
// nonce (bukan gugur lebih awal di PoW/hash/struktur dengan fatal yang
// kebetulan sama).
console.log('\nGROUP 5 — klasifikasi P2P connectBlock (nonce FATAL):')

const SENDER_P2P = `NxC${'9p'.repeat(20)}`
await fund(SENDER_P2P)
{
	const { prepareBlockForHashing } =
		await import('src/core/block/prepareBlock')
	const { createPowHasher } = await import('src/core/consensus/Pow')
	const { meetsDifficulty } = await import('src/core/consensus/difficulty')
	const { verifyPow } = await import(
		'src/core/consensus/verify/module/verifyPow'
	)
	const { verifyBlockHash } = await import(
		'src/core/consensus/verify/module/verifyBlockHash'
	)
	const { getCurrentBlock: getTip } = await import(
		'src/core/block/query/onChain/block/getCurrentBlock'
	)
	const { connectBlock } = await import('src/p2p/validation/connectBlock')

	const tipBefore = (await getTip('json')) as Block
	const tipHashBefore = tipBefore.block.header.hash
	// Template di atas tip, berisi tx nonce-lompat (nonce akun 0, tx nonce 5).
	const bad = await createBlockTemplate(
		[makeTx(SENDER_P2P, 5, 'p2p-fatal')],
		MINER,
	)
	ok(
		'template P2P menempel ke tip (height=tip+1)',
		bad.block.height === tipBefore.block.height + 1,
	)

	// Tambang PoW nyata: `connectBlock` memverifikasi PoW + hash blok
	// SEBELUM mencapai pra-penerbangan nonce.
	const targetDiff = bad.block.header.difficulty
	const hasher = createPowHasher(prepareBlockForHashing(bad))
	let solved = -1
	for (let n = 0; n < 50_000_000; n++) {
		if (meetsDifficulty(hasher.hash(n), targetDiff)) {
			solved = n
			break
		}
	}
	ok('PoW nyata terselesaikan di dalam batas', solved >= 0)
	if (solved >= 0) {
		bad.block.header.nonce = solved
		bad.block.header.hash = hasher.hash(solved)
	}
	ok('blok P2P lolos verifyPow', verifyPow(bad))
	let hashOk = false
	try {
		hashOk = verifyBlockHash(bad)
	} catch {
		hashOk = false
	}
	ok('blok P2P lolos verifyBlockHash', hashOk)
	let nonceErr: unknown = null
	try {
		await verifyBlockNonceOrder(bad)
	} catch (error) {
		nonceErr = error
	}
	ok(
		'blok P2P memang NonceMismatchError (alasan yang tepat)',
		isNonceMismatchError(nonceErr),
	)

	// Ujung-ke-ujung: kirim sebagai pesan peer (round-trip JSON, seperti kabel).
	const res = await connectBlock(JSON.parse(JSON.stringify(bad)))
	ok('connectBlock MENOLAK blok nonce-rusak', res.ok === false)
	ok(
		'penolakan FATAL (peer layak ban)',
		res.fatal === true,
		`ok=${res.ok} fatal=${res.fatal} reason=${res.reason ?? ''}`,
	)
	ok(
		'alasan menyebut nonce',
		(res.reason ?? '').toLowerCase().includes('nonce'),
		res.reason ?? '(tanpa alasan)',
	)
	const tipAfter = (await getTip('json')) as Block
	ok(
		'tip tak berubah (blok tidak ter-commit)',
		tipAfter.block.header.hash === tipHashBefore,
	)
}

// ---------------------------------------------------------------------------
// GROUP 1 — pra-penerbangan menolak, template menerima yang sah
// ---------------------------------------------------------------------------
console.log('\nGROUP 1 — commitBlock menolak urutan rusak:')

await fund(SENDER_T1)
{
	const before = await snapshot(SENDER_T1)
	// Urutan acak: nonce 1 dulu lalu 0 — wajib ditolak.
	const rejected = await commitTxs([
		makeTx(SENDER_T1, 1, 't1-acak'),
		makeTx(SENDER_T1, 0, 't1-acak'),
	])
	const after = await snapshot(SENDER_T1)
	ok('blok nonce acak (1,0) DITOLAK', rejected === false)
	ok(
		'penolakan bersih: saldo/nonce tak berubah',
		after.balance === before.balance && after.nonce === before.nonce,
		`before=${before.balance}/${before.nonce} after=${after.balance}/${after.nonce}`,
	)
}

await fund(SENDER_T2)
{
	const before = await snapshot(SENDER_T2)
	// Lubang: nonce 0 lalu 2 (1 hilang) — wajib ditolak.
	const rejected = await commitTxs([
		makeTx(SENDER_T2, 0, 't2-gap'),
		makeTx(SENDER_T2, 2, 't2-gap'),
	])
	const after = await snapshot(SENDER_T2)
	ok('blok berlubang (0,2) DITOLAK', rejected === false)
	ok(
		'penolakan gap bersih: saldo/nonce tak berubah',
		after.balance === before.balance && after.nonce === before.nonce,
		`before=${before.balance}/${before.nonce} after=${after.balance}/${after.nonce}`,
	)
}

await fund(SENDER_T3)
{
	// Bebas-gap menaik — wajib diterima.
	const accepted = await commitTxs([
		makeTx(SENDER_T3, 0, 't3-ok'),
		makeTx(SENDER_T3, 1, 't3-ok'),
	])
	const after = await snapshot(SENDER_T3)
	ok('blok bebas-gap (0,1) DITERIMA', accepted === true)
	ok('nonce pengirim maju 2 langkah', after.nonce === 2, `nonce=${after.nonce}`)
	ok(
		'saldo terdebet amount+fee tiap tx',
		after.balance === FUND - 2 * (10 + 1),
		`balance=${after.balance}`,
	)
}

// ---------------------------------------------------------------------------
// GROUP 2 — multi-pengirim & duplikat
// ---------------------------------------------------------------------------
console.log('\nGROUP 2 — multi-pengirim & duplikat:')

await fund(SENDER_T4A)
await fund(SENDER_T4B)
{
	// Urutan antar-pengirim tak relevan — hanya urutan internal tiap
	// pengirim yang dihitung. Interleaving A0,B0,A1,B1 wajib diterima.
	const accepted = await commitTxs([
		makeTx(SENDER_T4A, 0, 't4-inter'),
		makeTx(SENDER_T4B, 0, 't4-inter'),
		makeTx(SENDER_T4A, 1, 't4-inter'),
		makeTx(SENDER_T4B, 1, 't4-inter'),
	])
	const afterA = await snapshot(SENDER_T4A)
	const afterB = await snapshot(SENDER_T4B)
	ok('blok interleaved dua pengirim DITERIMA', accepted === true)
	ok(
		'kedua nonce maju',
		afterA.nonce === 2 && afterB.nonce === 2,
		`A=${afterA.nonce} B=${afterB.nonce}`,
	)
}

await fund(SENDER_T5)
{
	// Duplikat yang sudah dieksekusi di dalam blok yang sah: dilewati,
	// bukan crash, dan blok tetap diterima.
	const first = await commitTxs([makeTx(SENDER_T5, 0, 't5-dup')])
	const dupTx = makeTx(SENDER_T5, 0, 't5-dup')
	const accepted = await commitTxs([dupTx, makeTx(SENDER_T5, 1, 't5-dup')])
	const after = await snapshot(SENDER_T5)
	ok('blok pertama (nonce 0) DITERIMA', first === true)
	ok('blok berisi duplikat tereksekusi DITERIMA (dilewati)', accepted === true)
	ok(
		'duplikat tak dieksekusi ulang (nonce tepat 2)',
		after.nonce === 2,
		`nonce=${after.nonce}`,
	)
}

// ---------------------------------------------------------------------------
// GROUP 3 — unit pra-penerbangan langsung (bentuk galat)
// ---------------------------------------------------------------------------
console.log('\nGROUP 3 — bentuk galat pra-penerbangan:')

await fund(`NxC${'ee'.repeat(20)}`)
{
	const bad = await createBlockTemplate(
		[makeTx(`NxC${'ee'.repeat(20)}`, 5, 't-err')],
		MINER,
	)
	let caught: unknown = null
	try {
		await verifyBlockNonceOrder(bad)
	} catch (error) {
		caught = error
	}
	ok('verifyBlockNonceOrder MELEMPAR untuk nonce salah', caught !== null)
	ok(
		'galatnya NonceMismatchError (nama/pesan jelas)',
		isNonceMismatchError(caught) &&
			String((caught as Error).message).includes('5'),
		caught instanceof Error ? caught.message.slice(0, 60) : '',
	)
}

// ---------------------------------------------------------------------------
// GROUP 4 — template work.ts bebas-gap
// ---------------------------------------------------------------------------
console.log('\nGROUP 4 — template work.ts bebas-gap:')

await fund(SENDER_T6)
{
	// Isi mempool dengan set berlubang/acak untuk satu pengirim, lalu
	// susun lewat jalur produksi (`MemPool.getValidTransactions` +
	// `selectGapFreeTransactions` — persis `work.ts`).
	const gapped = [
		makeTx(SENDER_T6, 3, 't6-gap'),
		makeTx(SENDER_T6, 0, 't6-gap'),
		makeTx(SENDER_T6, 2, 't6-gap'),
	]
	for (const tx of gapped) await saveMempool(tx)
	const pool = new MemPool()
	const loaded = await pool.getValidTransactions()
	const mine = loaded.filter((tx) => tx.from === SENDER_T6)
	const selected = await selectGapFreeTransactions(mine)
	const nonces = selected.map((tx) => tx.nonce)
	ok(
		'input berlubang {0,2,3} → template hanya [0]',
		nonces.length === 1 && nonces[0] === 0,
		`[${nonces.join(',')}]`,
	)

	const ordered = [
		makeTx(SENDER_T6, 2, 't6-penuh'),
		makeTx(SENDER_T6, 0, 't6-penuh'),
		makeTx(SENDER_T6, 1, 't6-penuh'),
	]
	const selectedFull = await selectGapFreeTransactions(ordered)
	const fullNonces = selectedFull.map((tx) => tx.nonce)
	ok(
		'input acak {2,0,1} → template urut [0,1,2]',
		fullNonces.length === 3 &&
			fullNonces[0] === 0 &&
			fullNonces[1] === 1 &&
			fullNonces[2] === 2,
		`[${fullNonces.join(',')}]`,
	)
	const again = await selectGapFreeTransactions(ordered)
	ok(
		'template deterministik (input sama → susunan sama)',
		again.map((tx) => tx.txHash).join(',') ===
			selectedFull.map((tx) => tx.txHash).join(','),
	)
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
await rocksState.close().catch(() => undefined)
await rocksHistory.close().catch(() => undefined)
await rocksBlock.close().catch(() => undefined)
await rocksJournal.close().catch(() => undefined)
await rocksMempool.close().catch(() => undefined)
try {
	fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {
	console.log(`  (catatan) tidak bisa menghapus ${tmpDir} — dilewati`)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
