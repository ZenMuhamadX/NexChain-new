/**
 * Gerbang regresi "reserve mempool turunan per-pengirim (Gelombang 2)".
 *
 * Jalankan:  bun run check:mempool-reserve
 *
 * Kunci `pendingBalance:<alamat>` yang tersimpan SUDAH DIHAPUS — reserve
 * kini murni turunan dari indeks per-pengirim (`mpf:<from>:<txHash>` yang
 * ditulis ATOMIK bersama tx oleh `saveMempool`). Yang dibuktikan:
 *
 *   (a) `sumCostBySender(from)` === Σ(amount+fee) tx pengirim itu;
 *   (b) `senderIndexStats(from).count === countPendingBySender(from)`
 *       (satu pindai, tidak mungkin berbeda pendapat);
 *   (c) pembaca turunan `getPendingBalance(addr).pendingAmount` identik
 *       dengan `sumCostBySender(addr)`, dan reserve TURUN tepat sebesar
 *       cost tx yang dibuang `removeMemPool` (pelepasan terjadi saat tx
 *       keluar dari mempool — bukan via counter terpisah).
 *
 * Memakai `NEX_DATA_DIR` sementara (LevelDB nyata, dibuang setelahnya).
 * Modul DB diimpor SESUDAH env diset.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TxInterface } from 'src/types/transaction'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`)
	}
}

// ---------------------------------------------------------------------------
// DB temp + impor dinamis (env harus diset SEBELUM modul DB diimpor)
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-mempool-reserve-'))
process.env.NEX_DATA_DIR = tmpDir

const { rocksMempool } = await import('src/core/state/db/memPool')
const { saveMempool } =
	await import('src/core/state/storage/mempool/saveMemPool')
const { removeMemPool } =
	await import('src/core/state/storage/mempool/removeMempool')
const { countPendingBySender, senderIndexStats, sumCostBySender } =
	await import('src/core/state/storage/mempool/mempoolIndex')
const { getPendingBalance } =
	await import('src/core/transaction/getPendingBalance')

await rocksMempool.open()

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const SENDER_A = `NxC${'ab'.repeat(20)}`
const SENDER_B = `NxC${'cd'.repeat(20)}`
const SENDER_EMPTY = `NxC${'ef'.repeat(20)}`

/** Transaksi minimal yang cukup untuk `saveMempool` (butuh txHash & from). */
const fakeTx = (
	from: string,
	txHash: string,
	amount: number,
	fee: number,
	nonce: number,
): TxInterface =>
	({
		nonce,
		fee,
		receiver: `NxC${'11'.repeat(20)}`,
		amount,
		sign: { v: 0, r: 'a'.repeat(64), s: 'b'.repeat(64) },
		from,
		txHash,
	}) as TxInterface

// Pengirim A: tiga tx dengan cost berbeda; pengirim B: satu tx (isolasi).
const txsA = [
	fakeTx(SENDER_A, 'a1'.padEnd(64, '0'), 100, 5, 0),
	fakeTx(SENDER_A, 'a2'.padEnd(64, '0'), 250, 10, 1),
	fakeTx(SENDER_A, 'a3'.padEnd(64, '0'), 1_000, 25, 2),
]
const txB = fakeTx(SENDER_B, 'b1'.padEnd(64, '0'), 50, 5, 0)

for (const tx of [...txsA, txB]) await saveMempool(tx)

const expectedA = txsA.reduce((sum, tx) => sum + tx.amount + tx.fee, 0)
const expectedB = txB.amount + txB.fee

// ---------------------------------------------------------------------------
// (a) reserve turunan === Σ(amount+fee)
// ---------------------------------------------------------------------------
console.log('\nGROUP 1 — reserve turunan === Σ(amount+fee):')

ok(
	'sumCostBySender(A) === Σ cost tx A',
	(await sumCostBySender(SENDER_A)) === expectedA,
	`got=${await sumCostBySender(SENDER_A)} expected=${expectedA}`,
)
ok(
	'sumCostBySender(B) === Σ cost tx B (isolasi antar-pengirim)',
	(await sumCostBySender(SENDER_B)) === expectedB,
	`got=${await sumCostBySender(SENDER_B)} expected=${expectedB}`,
)
ok(
	'sumCostBySender(pengirim kosong) === 0',
	(await sumCostBySender(SENDER_EMPTY)) === 0,
)

// ---------------------------------------------------------------------------
// (b) satu pindai: count === countPendingBySender
// ---------------------------------------------------------------------------
console.log('\nGROUP 2 — satu pindai (count + cost konsisten):')

const statsA = await senderIndexStats(SENDER_A)
ok(
	'senderIndexStats(A).count === countPendingBySender(A)',
	statsA.count === (await countPendingBySender(SENDER_A)),
)
ok(
	'senderIndexStats(A).count === 3 (tanpa potong global)',
	statsA.count === txsA.length,
	`got=${statsA.count}`,
)
ok(
	'senderIndexStats(A).totalCost === sumCostBySender(A)',
	statsA.totalCost === (await sumCostBySender(SENDER_A)),
)
ok(
	'countPendingBySender(pengirim kosong) === 0',
	(await countPendingBySender(SENDER_EMPTY)) === 0,
)

// ---------------------------------------------------------------------------
// (c) pembaca turunan identik dengan indeks; pelepasan via removeMemPool
// ---------------------------------------------------------------------------
// Tidak ada lagi kunci `pendingBalance` tersimpan — `getPendingBalance`
// murni menghitung dari indeks yang sama dengan `sumCostBySender`, dan
// reserve "dilepas" dengan membuang tx (indeksnya ikut terhapus atomik).
console.log('\nGROUP 3 — pembaca turunan + pelepasan via removeMemPool:')

ok(
	'getPendingBalance(A).pendingAmount === sumCostBySender(A)',
	(await getPendingBalance(SENDER_A)).pendingAmount ===
		(await sumCostBySender(SENDER_A)),
	`reader=${(await getPendingBalance(SENDER_A)).pendingAmount} derived=${await sumCostBySender(SENDER_A)}`,
)
ok(
	'getPendingBalance(B).pendingAmount === sumCostBySender(B)',
	(await getPendingBalance(SENDER_B)).pendingAmount ===
		(await sumCostBySender(SENDER_B)),
)

// Buang satu tx A — reserve harus TURUN tepat sebesar cost tx itu.
const droppedCost = txsA[0]!.amount + txsA[0]!.fee
await removeMemPool(txsA[0]!.txHash!)
const afterDrop = (await getPendingBalance(SENDER_A)).pendingAmount
ok(
	'reserve TURUN tepat sebesar cost tx yang dibuang',
	afterDrop === expectedA - droppedCost,
	`got=${afterDrop} expected=${expectedA - droppedCost}`,
)
ok(
	'pembaca tetap identik dengan indeks setelah pembuangan',
	afterDrop === (await sumCostBySender(SENDER_A)),
)

// Buang sisanya — reserve kembali ke 0 tanpa counter terpisah.
await removeMemPool(txsA[1]!.txHash!)
await removeMemPool(txsA[2]!.txHash!)
await removeMemPool(txB.txHash!)
ok(
	'reserve A → 0 setelah semua tx-nya dibuang',
	(await getPendingBalance(SENDER_A)).pendingAmount === 0,
)
ok(
	'reserve B → 0 setelah tx-nya dibuang',
	(await getPendingBalance(SENDER_B)).pendingAmount === 0,
)

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
await rocksMempool.close().catch(() => undefined)
try {
	fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {
	console.log(`  (catatan) tidak bisa menghapus ${tmpDir} — dilewati`)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
