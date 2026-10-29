/**
 * Gerbang regresi "sweep mempool + cap per-pengirim 16 (Gelombang 4)".
 *
 * Jalankan:  bun run check:mempool-sweep
 *
 * Yang dibuktikan:
 *
 *   1. **Cap per-pengirim = 16 (KEBIJAKAN node, bukan konsensus)** — 16 tx
 *      pending dari satu pengirim DITERIMA lewat jalur admission produksi
 *      (`MemPool.addTransaction`); tx ke-17 DITOLAK; pengirim lain tak
 *      terpengaruh.
 *   2. **Sapuan keterjangkauan** — pool yang melebihi saldo dipangkas
 *      sampai prefix kontigu terjangkau; prefix yang bertahan TEPAT, ekor
 *      yang dibuang TEPAT, dan `sumCostBySender` turun ke cost prefix.
 *   3. **Basi** — tx `nonce < account.nonce` dibuang.
 *   4. **Gagal-aman** — pengirim tanpa akun tersimpan DILEWATI utuh
 *      (tanpa crash, tanpa buang massal).
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-mempool-sweep-'))
process.env.NEX_DATA_DIR = tmpDir

const { rocksState } = await import('src/core/state/db/state')
const { rocksHistory } = await import('src/core/state/db/history')
const { rocksMempool } = await import('src/core/state/db/memPool')
const { putAccount } = await import('src/core/state/account/putAccount')
const { saveMempool } =
	await import('src/core/state/storage/mempool/saveMemPool')
const { countPendingBySender, sumCostBySender, MAX_PENDING_PER_SENDER } =
	await import('src/core/state/storage/mempool/mempoolIndex')
const { sweepUnaffordableMempool } =
	await import('src/core/state/storage/mempool/sweepMempool')
const { MemPool } = await import('src/core/transaction/memPool')
const { generateKeysFromMnemonic } =
	await import('src/crypto/generateKeyFromMnemonic')
const { generateAddressFromPublicKey } =
	await import('src/crypto/generateAddressFromPublicKey')
const { createUnsignedTransaction } =
	await import('src/client/lib/createUnsignedTransaction')
const { signTransaction } = await import('src/crypto/signTransaction')

await rocksState.open()
await rocksHistory.open()
await rocksMempool.open()

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

const RECEIVER = `NxC${'99'.repeat(20)}`

const fund = async (address: string, balance: number): Promise<void> => {
	await putAccount(address, {
		address,
		balance,
		transactionCount: 0,
		lastTransactionDate: 1_700_000_000_000,
		nonce: 0,
	})
}

/** Tx mainan TANPA tanda tangan — cukup untuk `saveMempool` + sapuan. */
const fakeTx = (
	from: string,
	tag: string,
	nonce: number,
	cost: number,
): TxInterface =>
	({
		nonce,
		fee: 50,
		receiver: RECEIVER,
		amount: cost - 50,
		from,
		txHash: `TxC${`${tag}${nonce}`.padEnd(64, '0')}`,
		sign: { v: 27, r: '0x01', s: '0x01' },
	}) as TxInterface

// ---------------------------------------------------------------------------
// GROUP 1 — cap per-pengirim 16 lewat admission produksi
// ---------------------------------------------------------------------------
console.log('\nGROUP 1 — cap per-pengirim 16 (policy admission):')

ok('MAX_PENDING_PER_SENDER === 16', MAX_PENDING_PER_SENDER === 16)

// Dua penanda tangan berbeda: `from` = hasil ecrecover, jadi alamatnya
// diturunkan dari kunci yang sama agar lolos `validateTransactionSignature`.
const MNEMONIC_A =
	'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const MNEMONIC_B =
	'legal winner thank year wave sausage worth useful legal winner thank yellow'
const keysA = generateKeysFromMnemonic(MNEMONIC_A)
const keysB = generateKeysFromMnemonic(MNEMONIC_B)
const SENDER_CAP = generateAddressFromPublicKey(keysA.publicKey)
const SENDER_OTHER = generateAddressFromPublicKey(keysB.publicKey)

await fund(SENDER_CAP, 1_000_000_000)
await fund(SENDER_OTHER, 1_000_000_000)

const buildValid = (
	keys: { privateKey: string },
	sender: string,
	nonce: number,
): TxInterface => {
	const draft = createUnsignedTransaction(
		{
			amount: 1_000_000,
			format: 'nexu',
			// `sender` hanya dipakai pemanggil untuk ambil nonce; tidak ikut tx.
			sender,
			receiver: RECEIVER,
			fee: 5_000,
		},
		nonce,
	)
	if (!draft.status || !draft.tx) throw new Error('fixture cap gagal dibangun')
	return signTransaction(draft.tx, keys.privateKey)
}

const pool = new MemPool()
let accepted = 0
let seventeenth: boolean | null = null
for (let i = 0; i < 17; i++) {
	const result = await pool.addTransaction(buildValid(keysA, SENDER_CAP, i))
	if (result.isValid) accepted++
	if (i === 16) seventeenth = result.isValid
}
ok('16 tx pertama DITERIMA', accepted === 16, `accepted=${accepted}`)
ok('tx ke-17 DITOLAK (cap)', seventeenth === false)
ok(
	'pool pengirim cap TEPAT 16 (ke-17 tak tersimpan)',
	(await countPendingBySender(SENDER_CAP)) === 16,
	`count=${await countPendingBySender(SENDER_CAP)}`,
)
ok(
	'pengirim lain tak terpengaruh (1 tx DITERIMA)',
	(await pool.addTransaction(buildValid(keysB, SENDER_OTHER, 0))).isValid ===
		true,
)

// ---------------------------------------------------------------------------
// GROUP 2 — sapuan: prefix terjangkau bertahan, ekor dibuang
// ---------------------------------------------------------------------------
console.log('\nGROUP 2 — sapuan keterjangkauan:')

const SENDER_S = `NxC${'5a'.repeat(20)}`
await fund(SENDER_S, 1_000)
const COSTS_S = [200, 300, 400, 500, 600]
for (let n = 0; n < COSTS_S.length; n++) {
	await saveMempool(fakeTx(SENDER_S, 's', n, COSTS_S[n]!))
}

const sweepS = await sweepUnaffordableMempool()
const droppedS = sweepS.dropped.filter((d) => d.from === SENDER_S)
ok(
	'ekor tak-terjangkau (nonce 3,4) dibuang',
	droppedS.length === 2 && droppedS[0]!.nonce === 3 && droppedS[1]!.nonce === 4,
	droppedS.map((d) => `${d.nonce}:${d.reason}`).join(','),
)
ok(
	'alasan buang = unaffordable',
	droppedS.every((d) => d.reason === 'unaffordable'),
)
ok(
	'prefix [0,1,2] bertahan (count === 3)',
	(await countPendingBySender(SENDER_S)) === 3,
	`count=${await countPendingBySender(SENDER_S)}`,
)
ok(
	'sumCostBySender turun TEPAT ke cost prefix (900)',
	(await sumCostBySender(SENDER_S)) === 900,
	`sum=${await sumCostBySender(SENDER_S)}`,
)

// ---------------------------------------------------------------------------
// GROUP 3 — nonce basi dibuang
// ---------------------------------------------------------------------------
console.log('\nGROUP 3 — nonce basi:')

const SENDER_T = `NxC${'7b'.repeat(20)}`
await fund(SENDER_T, 50_000)
// Akun sudah nonce 3 → tx nonce 1,2 basi; 3,4 segar & terjangkau.
await putAccount(SENDER_T, {
	address: SENDER_T,
	balance: 50_000,
	transactionCount: 3,
	lastTransactionDate: 1_700_000_000_000,
	nonce: 3,
})
for (const n of [1, 2, 3, 4]) await saveMempool(fakeTx(SENDER_T, 't', n, 100))

const sweepT = await sweepUnaffordableMempool()
const droppedT = sweepT.dropped.filter((d) => d.from === SENDER_T)
ok(
	'tx basi (nonce 1,2) dibuang',
	droppedT.length === 2 && droppedT[0]!.nonce === 1 && droppedT[1]!.nonce === 2,
	droppedT.map((d) => `${d.nonce}:${d.reason}`).join(','),
)
ok(
	'alasan buang = stale',
	droppedT.every((d) => d.reason === 'stale'),
)
ok(
	'tx segar (nonce 3,4) bertahan',
	(await countPendingBySender(SENDER_T)) === 2 &&
		(await sumCostBySender(SENDER_T)) === 200,
	`count=${await countPendingBySender(SENDER_T)}`,
)

// ---------------------------------------------------------------------------
// GROUP 4 — gagal-aman: pengirim tanpa akun dilewati utuh
// ---------------------------------------------------------------------------
console.log('\nGROUP 4 — gagal-aman (tanpa akun):')

const SENDER_U = `NxC${'8c'.repeat(20)}`
// SENGAJA tanpa putAccount — akun tak tersimpan.
await saveMempool(fakeTx(SENDER_U, 'u', 0, 100))
await saveMempool(fakeTx(SENDER_U, 'u', 1, 100))

let crashed = false
let sweepU = { dropped: [] as { from: string }[] }
try {
	sweepU = await sweepUnaffordableMempool()
} catch {
	crashed = true
}
ok('sapuan tak crash untuk pengirim tanpa akun', crashed === false)
ok(
	'pengirim tanpa akun tak dibuang massal (count tetap 2)',
	(await countPendingBySender(SENDER_U)) === 2,
	`count=${await countPendingBySender(SENDER_U)}`,
)
ok(
	'reserve-nya utuh (sum tetap 200)',
	(await sumCostBySender(SENDER_U)) === 200,
)
ok(
	'tak ada drop untuk pengirim tanpa akun',
	sweepU.dropped.filter((d) => d.from === SENDER_U).length === 0,
)

// Sapuan idempoten: pool sudah bersih → tak ada yang dibuang lagi.
const sweepAgain = await sweepUnaffordableMempool()
ok(
	'sapuan ulang tak membuang apa pun (idempoten)',
	sweepAgain.dropped.length === 0,
	`dropped=${sweepAgain.dropped.length}`,
)

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------
await rocksState.close().catch(() => undefined)
await rocksHistory.close().catch(() => undefined)
await rocksMempool.close().catch(() => undefined)
try {
	fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {
	console.log(`  (catatan) tidak bisa menghapus ${tmpDir} — dilewati`)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
