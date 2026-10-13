/**
 * Gerbang regresi "kebijakan transaksi P1" — audit #4 (severe).
 *
 * Jalankan:  bun run check:txpolicy
 *
 * Tiga kelompok yang dicegah regresinya:
 *
 *   1. **Lantai laju-fee** (1000 nexu/kB = 1 nexu/byte) — `isValidTxFee`
 *      menolak fee di bawah `ceil(ukuran wire × rate / 1000)`, tetap
 *      mempertahankan aturan lama (fee ≥ 0, fee ≤ amount), dan menimbang
 *      ukuran wire kanonik (`encodeTxPayload`) — bukan ukuran JSON.
 *   2. **Akuntansi nonce per-pengirim** — jumlah tx pending diambil dari
 *      indeks per-pengirim (`countPendingBySender`), BUKAN `loadMempool`
 *      yang terpotong 100 entri global. Sender dengan N > 100 tx pending
 *      tetap diharapkan nonce = akun.nonce + N; tx pengirim lain tidak
 *      mengubah harapan ini.
 *   3. **getPendingBalance aman** — alamat tidak valid MELEMPAR (bukan
 *      diam-diam 0), dan membaca reserve yang tidak ada TIDAK menulis apa
 *      pun (tanpa tulis-saat-baca).
 *
 * Bagian 1 murni (tanpa DB). Bagian 2 & 3 menyentuh storage, jadi memakai
 * `NEX_DATA_DIR` sementara (LevelDB nyata di folder buangan) — modul
 * tinggal diimpor sesudah env diset, supaya `DATA_DIR` (dihitung sekali
 * saat muat modul) menunjuk ke folder itu. Ini bukan "fake" yang menyamarkan
 * perilaku; ini modul produksi yang sama terhadap database yang dibuang.
 *
 * Pemakaian storage ditutup dengan `close()` lalu folder dibuang, sehingga
 * gate ini aman dijalankan berdampingan dengan node yang hidup.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

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

/** Panggil `fn` asinkron, kembalikan Error yang dilempar, atau null. */
const caughtAsync = async (
	fn: () => Promise<unknown>,
): Promise<Error | null> => {
	try {
		await fn()
		return null
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error))
	}
}

// ---------------------------------------------------------------------------
// 1. Lantai laju-fee — murni, tanpa DB
// ---------------------------------------------------------------------------
//
// Impor statis aman di sini: jalur `isValidTxFee` -> `txCodec` -> rlp/sha256
// tidak menyentuh storage (terbukti `check:browser` membundelnya).

import {
	validateTransactionFees,
	MIN_FEE_RATE_NEXU_PER_KB,
} from 'src/core/validation/module/isValidTxFee'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import type { TxInterface } from 'src/types/transaction'
import type { comTxInterface } from 'src/types/compositeTransaction'
import type { structBalance } from 'src/types/balance'

console.log('GROUP 1 — lantai laju-fee (murni):')

ok(
	'MIN_FEE_RATE_NEXU_PER_KB === 1000 (1 nexu/byte)',
	MIN_FEE_RATE_NEXU_PER_KB === 1000,
)

const MNEMONIC =
	'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const { privateKey } = generateKeysFromMnemonic(MNEMONIC)
const RECEIVER = `NxC${'22'.repeat(20)}`

const buildSigned = (fee: number, data?: string): TxInterface => {
	const input: comTxInterface = {
		amount: 1_000_000,
		format: 'nexu',
		// `sender` hanya dipakai pemanggil untuk ambil nonce; tidak ikut tx.
		sender: `NxC${'11'.repeat(20)}`,
		receiver: RECEIVER,
		fee,
		...(data === undefined ? {} : { data: stringToHex(data) }),
	}
	const draft = createUnsignedTransaction(input, 0)
	if (!draft.status || !draft.tx) throw new Error('fixture gagal dibangun')
	return signTransaction(draft.tx, privateKey)
}

// Ukuran wire nyata sebuah transaksi bertanda tangan.
const S = encodeTxPayload(buildSigned(5000)).length
ok(`ukuran wire terukur wajar (${S} byte)`, S > 50 && S < 4096, `${S}`)

// Batas eksplisit — deterministik, tanpa "main angka" karena fee mengubah
// lebar RLP-nya sendiri (fixed-point).
ok(
	'fee = S-1 (sizeBytes=S) DITOLAK',
	validateTransactionFees({ ...buildSigned(5000), fee: S - 1 }, S) === false,
)
ok(
	'fee = S (sizeBytes=S) DITERIMA',
	validateTransactionFees({ ...buildSigned(5000), fee: S }, S) === true,
)
ok(
	'2× ukuran → 2× min: fee=S di sizeBytes=2S DITOLAK',
	validateTransactionFees({ ...buildSigned(5000), fee: S }, 2 * S) === false,
)
ok(
	'2× ukuran → 2× min: fee=2S-1 di sizeBytes=2S DITOLAK',
	validateTransactionFees({ ...buildSigned(5000), fee: 2 * S - 1 }, 2 * S) ===
		false,
)
ok(
	'2× ukuran → 2× min: fee=2S di sizeBytes=2S DITERIMA',
	validateTransactionFees({ ...buildSigned(5000), fee: 2 * S }, 2 * S) === true,
)

// Jalur otomatis (tanpa sizeBytes) — validator mengukur sendiri lewat codec.
const kecil = buildSigned(1)
ok(
	'auto-size: fee=1 (wire ~' + S + ') DITOLAK',
	validateTransactionFees(kecil) === false,
)
const cukup = buildSigned(5000)
ok('auto-size: fee=5000 DITERIMA', validateTransactionFees(cukup) === true)
ok(
	'auto-size == ukuran encodeTxPayload',
	validateTransactionFees(cukup) ===
		validateTransactionFees(cukup, encodeTxPayload(cukup).length),
)

// Aturan lama tetap berlaku, tak peduli ukuran.
ok(
	'fee negatif DITOLAK',
	validateTransactionFees({ ...cukup, fee: -1 }, S) === false,
)
ok(
	'fee > amount DITOLAK',
	validateTransactionFees({ ...cukup, fee: cukup.amount * 2 }, S) === false,
)

// ---------------------------------------------------------------------------
// 2 & 3. Storage — NEX_DATA_DIR sementara, modul diimpor SESUDAH env diset
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-txpolicy-'))
process.env.NEX_DATA_DIR = tmpDir

// Impor dinamis: modul db menghitung `DATA_DIR` saat pertama dimuat, jadi
// env di atas harus sudah ada sebelum mereka masuk ke memori.
const { saveMempool } =
	await import('src/core/state/storage/mempool/saveMemPool')
const { countPendingBySender } =
	await import('src/core/state/storage/mempool/mempoolIndex')
const { loadMempool } =
	await import('src/core/state/storage/mempool/loadMempool')
const { validateTransactionNonce } =
	await import('src/core/validation/module/isValidTxNonce')
const { putAccount } = await import('src/core/state/account/putAccount')
const { getPendingBalance } =
	await import('src/core/transaction/getPendingBalance')
const { setPendingBalance } =
	await import('src/core/transaction/setPendingBalance')
const { processSender } =
	await import('src/core/transaction/sender/processSender')
const { rocksState } = await import('src/core/state/db/state')
const { rocksMempool } = await import('src/core/state/db/memPool')

const SENDER_A = `NxC${'aa'.repeat(20)}`
const SENDER_B = `NxC${'bb'.repeat(20)}`

// ---------------------------------------------------------------------------
// 2. Akuntansi nonce per-pengirim — >100 pending tidak memotong hitungan
// ---------------------------------------------------------------------------

console.log(
	'\nGROUP 2 — akuntansi nonce per-pengirim (indeks, bukan loadMempool):',
)

const fakeTx = (from: string, i: number): TxInterface =>
	({
		from,
		txHash: `TxC${i.toString(16).padStart(64, '0')}`,
		nonce: i,
		amount: 1000,
		fee: 1000,
		receiver: RECEIVER,
		sign: { v: 0, r: '0'.repeat(64), s: '0'.repeat(64) },
	}) as TxInterface

// Akun A ber-nonce 7 (bukan 0) supaya rumus "akun.nonce + N" benar-benar
// diuji, bukan kebetulan 0 + N.
const accountA: structBalance = {
	address: SENDER_A,
	balance: 0,
	transactionCount: 0,
	isContract: false,
	lastTransactionDate: null,
	nonce: 7,
}
await putAccount(SENDER_A, accountA)

const N_A = 150 // > 100 — melewati batas global loadMempool
for (let i = 0; i < N_A; i++) await saveMempool(fakeTx(SENDER_A, i))

// Pengirim lain ikut memenuhi mempool — tidak boleh mengubah harapan A.
const N_B = 10
for (let i = 0; i < N_B; i++) await saveMempool(fakeTx(SENDER_B, 1000 + i))

const countA = await countPendingBySender(SENDER_A)
const countB = await countPendingBySender(SENDER_B)
ok(
	`countPendingBySender(A) === ${N_A} (lengkap, tak terpotong)`,
	countA === N_A,
	`${countA}`,
)
ok(
	`countPendingBySender(B) === ${N_B} (terisolasi dari A)`,
	countB === N_B,
	`${countB}`,
)

// Bukti bahwa jalur LAMA salah: loadMempool terpotong, sehingga filter
// per-pengirim di bawah 100 tidak akan pernah melihat ke-150 tx A.
const loaded = await loadMempool()
const truncatedA = loaded.filter((tx) => tx.from === SENDER_A).length
ok(
	`loadMempool global terpotong (${loaded.length} < ${N_A + N_B}) — inilah cacat lama`,
	loaded.length < N_A + N_B && truncatedA < N_A,
	`loaded=${loaded.length}, terlihat-untuk-A=${truncatedA}`,
)

// Rumus nonce: harapan = akun.nonce (7) + jumlah pending (150) = 157.
const nonceTx = (from: string, nonce: number): TxInterface =>
	({ from, nonce }) as unknown as TxInterface
ok(
	'nonce = 7+150 = 157 DITERIMA (A)',
	(await validateTransactionNonce(nonceTx(SENDER_A, 157))) === true,
)
ok(
	'nonce = 156 DITOLAK (A)',
	(await validateTransactionNonce(nonceTx(SENDER_A, 156))) === false,
)
ok(
	'nonce = 158 DITOLAK (A)',
	(await validateTransactionNonce(nonceTx(SENDER_A, 158))) === false,
)
// B tidak punya akun (nonce 0) + 10 tx pending sendiri = 17? TIDAK: kalau
// 150 tx A merembet ke B, harapannya jadi 0+160. Yang benar hanya 0+10 = 10
// — inilah isolasi per-pengirim yang diuji.
ok(
	'nonce = 0+10 = 10 DITERIMA (B, tak terpengaruh 150 tx A)',
	(await validateTransactionNonce(nonceTx(SENDER_B, 10))) === true,
)
ok(
	'nonce = 11 DITOLAK (B)',
	(await validateTransactionNonce(nonceTx(SENDER_B, 11))) === false,
)
ok(
	'nonce = 160 DITOLAK (B — bukan gabungan A+B)',
	(await validateTransactionNonce(nonceTx(SENDER_B, 160))) === false,
)

// ---------------------------------------------------------------------------
// 3a. Pelepasan reserve — processSender mengurangi pending & menjaga ≥ 0
// ---------------------------------------------------------------------------

console.log('\nGROUP 3a — pelepasan reserve pending (processSender):')

const funded = `NxC${'cc'.repeat(20)}`
await putAccount(funded, {
	address: funded,
	balance: 1_000_000,
	transactionCount: 0,
	isContract: false,
	lastTransactionDate: null,
	nonce: 0,
})

// Reserve 5000 mewakili beberapa tx pending; eksekusi amount 3000 + fee 500
// melepas tepat 3500 → sisa reserve 1500.
await setPendingBalance({ address: funded, pendingAmount: 5000 })
const beforeRelease = (await getPendingBalance(funded)).pendingAmount
await processSender(funded, 3000, 500)
const afterRelease = (await getPendingBalance(funded)).pendingAmount
ok(
	'processSender melepas tepat amount+fee dari reserve',
	beforeRelease === 5000 && afterRelease === 1500,
	`${beforeRelease} -> ${afterRelease}`,
)

// Pelepasan GANDA tidak boleh negatif (guard Math.max(...,0)).
await setPendingBalance({ address: funded, pendingAmount: 1000 })
await processSender(funded, 1500, 200) // lepas 1700 dari reserve 1000
const clamped = (await getPendingBalance(funded)).pendingAmount
ok(
	'pelepasan melebihi reserve di-clamp ke 0 (tidak negatif)',
	clamped === 0,
	`${clamped}`,
)

// ---------------------------------------------------------------------------
// 3b. getPendingBalance — alamat invalid melempar, tanpa tulis-saat-baca
// ---------------------------------------------------------------------------

console.log('\nGROUP 3b — getPendingBalance aman:')

const err1 = await caughtAsync(() => getPendingBalance('bukan-alamat'))
ok(
	'alamat sampah MELEMPAR (bukan diam-diam 0)',
	err1 !== null && /alamat tidak valid/.test(err1.message),
	err1?.message,
)
const err2 = await caughtAsync(() => getPendingBalance(`NxC${'ab'.repeat(10)}`)) // 23 char
ok(
	'alamat panjang salah MELEMPAR',
	err2 !== null && /alamat tidak valid/.test(err2.message),
)
const err3 = await caughtAsync(() => getPendingBalance(''))
ok(
	'alamat kosong MELEMPAR',
	err3 !== null && /alamat tidak valid/.test(err3.message),
)

// Alamat sah tanpa reserve tersimpan -> 0, TANPA menulis kunci.
// Catatan: `rocksState.get` kunci hilang di sini RESOLVE `undefined`
// (bukan reject), jadi normalisasi dulu sebelum dibandingkan.
const virgin = `NxC${'dd'.repeat(20)}`
const readBefore = (await getPendingBalance(virgin)).pendingAmount
const keyAfter =
	(await rocksState.get(`pendingBalance:${virgin}`).catch(() => null)) ?? null
ok(
	'reserve hilang -> {pendingAmount:0} TANPA menulis kunci',
	readBefore === 0 && keyAfter === null,
	`amount=${readBefore}, keyTersimpan=${keyAfter !== null}`,
)

// ---------------------------------------------------------------------------
// tutup storage & buang folder sementara
// ---------------------------------------------------------------------------

await rocksMempool.close().catch(() => undefined)
await rocksState.close().catch(() => undefined)
try {
	fs.rmSync(tmpDir, { recursive: true, force: true })
} catch {
	console.log(`  (catatan) tidak bisa menghapus ${tmpDir} — dilewati`)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
