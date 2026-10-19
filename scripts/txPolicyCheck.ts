/**
 * Gerbang regresi "kebijakan transaksi P1" — audit #4 (severe).
 *
 * Jalankan:  bun run check:txpolicy
 *
 * Kelompok regresi yang dijaga:
 *
 *   1. **Lantai laju-fee** (1000 nexu/kB = 1 nexu/byte) — `isValidTxFee`
 *      menolak fee di bawah `ceil(ukuran wire × rate / 1000)`, mempertahankan
 *      guard lama fee ≥ 0 (A4b: batas `fee ≤ amount` DIHAPUS), dan menimbang
 *      ukuran wire kanonik (`encodeTxPayload`) — bukan ukuran JSON.
 *   2. **Akuntansi nonce per-pengirim** — jumlah tx pending diambil dari
 *      indeks per-pengirim (`countPendingBySender`), BUKAN `loadMempool`
 *      yang terpotong 100 entri global. Sender dengan N > 100 tx pending
 *      tetap diharapkan nonce = akun.nonce + N; tx pengirim lain tidak
 *      mengubah harapan ini.
 *   3. **getPendingReserve turunan aman** — alamat tidak valid MELEMPAR
 *      (bukan diam-diam 0); membaca reserve yang tidak ada menghasilkan 0
 *      TANPA menulis apa pun; dan reserve mengikuti siklus hidup nyata
 *      (admission via `saveMempool` me-reserve, `removeMemPool`
 *      melepas) — tidak ada lagi counter `pendingBalance` tersimpan.
 *   4. **RBF (penggantian)** — pengganti pada nonce yang sudah terisi harus
 *      ber-laju-fee LEBIH TINGGI (fee naik tapi jauh lebih gemuk pun
 *      ditolak); pengganti MENGGANTI dalam satu batch (pool tetap satu tx
 *      per nonce, reserve = cost pengganti), dan cap per-pengirim di-skip
 *      karena pengganti menempati slot yang sudah ada.
 *   5. **Cap byte global mempool** — evictasi memilih pengirim ber-tx
 *      termurah dan membuang EKOR antreannya, sehingga nonce tetap kontigu
 *      (konsensus `verifyBlockNonceOrder`); tx lebih murah dari seluruh isi
 *      pool ditolak TANPA evictasi; pengganti (RBF) diterima di pool yang
 *      persis penuh; dan tx raksasa (> cap) ditolak lewat jalur admission
 *      produksi `MemPool`.
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
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
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
const { privateKey, publicKey } = generateKeysFromMnemonic(MNEMONIC)
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

// Guard lama fee ≥ 0 tetap; A4b: fee > amount kini DITERIMA (batas itu
// dihapus — Bitcoin/Ethereum juga mengizinkan fee melebihi nilai transfer).
ok(
	'fee negatif DITOLAK (guard fail-closed)',
	validateTransactionFees({ ...cukup, fee: -1 }, S) === false,
)
ok(
	'fee > amount DITERIMA (A4b, batas dihapus)',
	validateTransactionFees({ ...cukup, fee: cukup.amount * 2 }, S) === true,
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
const { findPendingByNonce, readMempoolEntry, MAX_PENDING_PER_SENDER } =
	await import('src/core/state/storage/mempool/mempoolIndex')
const { loadMempool, loadAllMempool } =
	await import('src/core/state/storage/mempool/loadMempool')
const { validateTransactionNonce } =
	await import('src/core/validation/module/isValidTxNonce')
const { putAccount } = await import('src/core/state/account/putAccount')
const { getAccount } = await import('src/core/state/account/getAccount')
const { getPendingReserve } =
	await import('src/core/transaction/getPendingReserve')
const { sumCostBySender } =
	await import('src/core/state/storage/mempool/mempoolIndex')
const { removeMemPool } =
	await import('src/core/state/storage/mempool/removeMempool')
const { MemPool } = await import('src/core/transaction/memPool')
const { processSender } =
	await import('src/core/transaction/sender/processSender')
const { isNonceMismatchError } =
	await import('src/core/consensus/verify/module/verifyNonce')
const { rocksState } = await import('src/core/state/db/state')
const { rocksMempool } = await import('src/core/state/db/memPool')
const { enforceMempoolWireCap, MAX_MEMPOOL_WIRE_BYTES } =
	await import('src/core/state/storage/mempool/capMempool')
const { transactionValidator } =
	await import('src/core/validation/txValidator.v')

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
// 3a. Reserve turunan mengikuti siklus hidup nyata (admission → eksekusi →
//     keluar-mempool) — tanpa counter tersimpan
// ---------------------------------------------------------------------------
//
// Tidak ada lagi `setPendingBalance`: admission (`MemPool`, jalur produksi
// yang sama dengan `nex_sendTransaction`) me-reserve secara IMPLISIT karena
// `saveMempool` menulis tx + indeks pengirimnya atomik; eksekusi
// (`processSender`) hanya mendebit saldo; pelepasan terjadi saat tx keluar
// dari mempool (`removeMemPool`, seperti `processTransaction` tiap commit).

console.log('\nGROUP 3a — reserve turunan mengikuti siklus hidup nyata:')

// Pengirim = pemilik MNEMONIC di atas — `from` adalah hasil ecrecover atas
// tanda tangan, jadi alamatnya diturunkan dari kunci yang sama (bukan alamat
// bebas yang tidak akan lolos `validateTransactionSignature`).
const SENDER_C = generateAddressFromPublicKey(publicKey.slice(2))
await putAccount(SENDER_C, {
	address: SENDER_C,
	balance: 100_000_000,
	transactionCount: 0,
	isContract: false,
	lastTransactionDate: null,
	nonce: 0,
})

const buildValid = (
	amount: number,
	fee: number,
	nonce: number,
): TxInterface => {
	const draft = createUnsignedTransaction(
		{
			amount,
			format: 'nexu',
			// `sender` hanya dipakai pemanggil untuk ambil nonce; tidak ikut tx.
			sender: SENDER_C,
			receiver: RECEIVER,
			fee,
		},
		nonce,
	)
	if (!draft.status || !draft.tx) throw new Error('fixture 3a gagal dibangun')
	return signTransaction(draft.tx, privateKey)
}

const pool = new MemPool()
const txC1 = buildValid(100_000, 5_000, 0)
const txC2 = buildValid(200_000, 5_000, 1)
const COST_C1 = 100_000 + 5_000
const COST_C2 = 200_000 + 5_000

ok(
	'admission tx1 DITERIMA (jalur MemPool produksi)',
	(await pool.addTransaction(txC1)).isValid === true,
)
ok(
	'admission me-reserve tepat cost tx1 (implisit via indeks)',
	(await getPendingReserve(SENDER_C)).pendingAmount === COST_C1,
	`pending=${(await getPendingReserve(SENDER_C)).pendingAmount}`,
)
ok(
	'admission tx2 DITERIMA (nonce = 0 + 1 pending)',
	(await pool.addTransaction(txC2)).isValid === true,
)
const reservedBoth = (await getPendingReserve(SENDER_C)).pendingAmount
ok(
	'reserve = Σ cost kedua tx DAN identik dengan indeks',
	reservedBoth === COST_C1 + COST_C2 &&
		reservedBoth === (await sumCostBySender(SENDER_C)),
	`pending=${reservedBoth}`,
)

// Eksekusi mendebit saldo TANPA menyentuh reserve — tx masih di mempool,
// jadi dananya tetap terkunci (inilah mengapa pelepasan milik
// `removeMemPool`, bukan `processSender`).
await processSender(SENDER_C, 100_000, 5_000, 0)
ok(
	'eksekusi mendebit tepat amount+fee dari saldo',
	(await getAccount(SENDER_C))?.balance === 100_000_000 - COST_C1,
	`balance=${(await getAccount(SENDER_C))?.balance}`,
)
ok(
	'reserve BELUM turun setelah eksekusi (tx masih pending)',
	(await getPendingReserve(SENDER_C)).pendingAmount === COST_C1 + COST_C2,
)

// Tx keluar dari mempool (seperti `processTransaction` tiap commit blok) →
// reserve turun tepat sebesar cost tx itu, tanpa counter terpisah.
await removeMemPool(txC1.txHash!)
const afterFirst = (await getPendingReserve(SENDER_C)).pendingAmount
ok(
	'keluar-mempool melepas tepat cost tx1',
	afterFirst === COST_C2,
	`pending=${afterFirst}`,
)
ok(
	'pembaca tetap identik dengan indeks setelah pelepasan',
	afterFirst === (await sumCostBySender(SENDER_C)),
)
await processSender(SENDER_C, 200_000, 5_000, 1)
await removeMemPool(txC2.txHash!)
ok(
	'reserve → 0 setelah semua tx keluar dari mempool',
	(await getPendingReserve(SENDER_C)).pendingAmount === 0,
)

// Lapis-2 urutan nonce di `processSender`. Pra-penerbangan
// (`verifyBlockNonceOrder`, sebelum WAL) adalah jaminan utama; assertion ini
// tripwire yang menangkap divergensi pre-flight vs eksekusi. Gagal-dulu:
// state tidak boleh tersentuh sama sekali. SENDER_C kini nonce 2.
const badNonce = await caughtAsync(() =>
	processSender(SENDER_C, 1_000, 1_000, 99),
)
ok(
	'processSender MELEMPAR NonceMismatchError pada nonce salah',
	badNonce !== null && isNonceMismatchError(badNonce),
	badNonce?.message,
)
const afterBad = await getAccount(SENDER_C)
ok(
	'akun TIDAK berubah setelah assertion (gagal sebelum putAccount)',
	afterBad?.nonce === 2 &&
		afterBad?.balance === 100_000_000 - COST_C1 - COST_C2,
	`nonce=${afterBad?.nonce}, balance=${afterBad?.balance}`,
)

// ---------------------------------------------------------------------------
// 3b. getPendingReserve turunan — alamat invalid melempar, tanpa tulis
// ---------------------------------------------------------------------------
// Pembaca kini murni turunan indeks mempool: ia tidak menyentuh store state
// sama sekali, jadi kunci `pendingBalance:<alamat>` TIDAK MUNGKIN muncul
// dari pembacaan (atau dari mana pun — penulisnya sudah dihapus).

console.log('\nGROUP 3b — getPendingReserve aman:')

const err1 = await caughtAsync(() => getPendingReserve('bukan-alamat'))
ok(
	'alamat sampah MELEMPAR (bukan diam-diam 0)',
	err1 !== null && /alamat tidak valid/.test(err1.message),
	err1?.message,
)
const err2 = await caughtAsync(() => getPendingReserve(`NxC${'ab'.repeat(10)}`)) // 23 char
ok(
	'alamat panjang salah MELEMPAR',
	err2 !== null && /alamat tidak valid/.test(err2.message),
)
const err3 = await caughtAsync(() => getPendingReserve(''))
ok(
	'alamat kosong MELEMPAR',
	err3 !== null && /alamat tidak valid/.test(err3.message),
)

// Alamat sah tanpa tx pending -> 0, TANPA menulis kunci.
// Catatan: `rocksState.get` kunci hilang di sini RESOLVE `undefined`
// (bukan reject), jadi normalisasi dulu sebelum dibandingkan.
const virgin = `NxC${'dd'.repeat(20)}`
const readBefore = (await getPendingReserve(virgin)).pendingAmount
const keyAfter =
	(await rocksState.get(`pendingBalance:${virgin}`).catch(() => null)) ?? null
ok(
	'tanpa tx pending -> {pendingAmount:0} TANPA menulis kunci',
	readBefore === 0 && keyAfter === null,
	`amount=${readBefore}, keyTersimpan=${keyAfter !== null}`,
)

// ---------------------------------------------------------------------------
// 4. RBF — penggantian tx pending pada nonce yang sudah terisi
// ---------------------------------------------------------------------------
//
// Kebijakan (bukan konsensus): pengganti wajib ber-laju-fee LEBIH TINGGI.
// Penggantian diuji lewat jalur PRODUKSI `MemPool.addTransaction` dengan
// transaksi bertanda tangan nyata — bukan lewat helper internal.

console.log('\nGROUP 4 — RBF (penggantian ber-laju-fee lebih tinggi):')

/** Bangun tx bertanda tangan untuk pengirim mana pun (bekal uji RBF). */
const buildRbf = (
	keys: ReturnType<typeof generateKeysFromMnemonic>,
	sender: string,
	amount: number,
	fee: number,
	nonce: number,
	data?: string,
): TxInterface => {
	const draft = createUnsignedTransaction(
		{
			amount,
			format: 'nexu',
			// `sender` hanya dipakai pemanggil untuk ambil nonce; tidak ikut tx.
			sender,
			receiver: RECEIVER,
			fee,
			...(data === undefined ? {} : { data: stringToHex(data) }),
		},
		nonce,
	)
	if (!draft.status || !draft.tx) throw new Error('fixture RBF gagal dibangun')
	return signTransaction(draft.tx, keys.privateKey)
}

// SENDER_C sudah nonce 2 (dua tx GROUP 3a tereksekusi) dan pool-nya kosong.
const COST_R1 = 1_000_000 + 5_000
const rbfTx1 = buildRbf(
	{ privateKey, publicKey },
	SENDER_C,
	1_000_000,
	5_000,
	2,
)
const rbfHash1 = rbfTx1.txHash!
const sizeR1 = encodeTxPayload(rbfTx1).length

ok(
	'admission tx nonce 2 DITERIMA (jalur MemPool produksi)',
	(await pool.addTransaction(rbfTx1)).isValid === true,
)
ok(
	'findPendingByNonce(SENDER_C, 2) menemukan tx itu',
	(await findPendingByNonce(SENDER_C, 2))?.txHash === rbfHash1,
)

// Tx identik (fee sama, ukuran sama) → laju sama → DITOLAK: aturannya `>`,
// bukan `>=`, supaya tx kembar tidak bisa saling menggantikan gratis.
ok(
	'pengganti IDENTIK (laju sama) DITOLAK',
	(
		await pool.addTransaction(
			buildRbf({ privateKey, publicKey }, SENDER_C, 1_000_000, 5_000, 2),
		)
	).isValid === false,
)

// Fee NAIK tapi ukuran jauh lebih besar (muatan `data`) → laju TURUN →
// DITOLAK. Inilah bukti aturannya LAJU (fee/byte), bukan angka fee: aturan
// "fee > fee lama" akan meloloskannya.
const gemuk = buildRbf(
	{ privateKey, publicKey },
	SENDER_C,
	1_000_000,
	5_100,
	2,
	'x'.repeat(300),
)
const sizeGemuk = encodeTxPayload(gemuk).length
ok(
	`fee naik (5.100 > 5.000) tapi laju turun (${sizeGemuk} > ${sizeR1} byte) DITOLAK`,
	(await pool.addTransaction(gemuk)).isValid === false,
	`ukuran ${sizeR1} → ${sizeGemuk}`,
)

ok(
	'dua penolakan di atas TIDAK mengubah pool (masih tx lama)',
	(await findPendingByNonce(SENDER_C, 2))?.txHash === rbfHash1 &&
		(await countPendingBySender(SENDER_C)) === 1 &&
		(await getPendingReserve(SENDER_C)).pendingAmount === COST_R1,
)

// Pengganti sah: laju-fee lebih tinggi pada nonce yang sama.
const COST_R2 = 1_000_000 + 20_000
const rbfTx2 = buildRbf(
	{ privateKey, publicKey },
	SENDER_C,
	1_000_000,
	20_000,
	2,
)
const rbfHash2 = rbfTx2.txHash!
ok(
	'pengganti ber-laju-fee lebih tinggi DITERIMA',
	(await pool.addTransaction(rbfTx2)).isValid === true,
)
ok(
	'tx LAMA benar-benar pergi (entri & indeksnya)',
	(await readMempoolEntry(rbfHash1)) === undefined &&
		(await findPendingByNonce(SENDER_C, 2))?.txHash === rbfHash2,
)
ok(
	'jumlah pending TETAP 1 (menggantikan, bukan menumpuk)',
	(await countPendingBySender(SENDER_C)) === 1,
)
ok(
	'reserve = cost pengganti (cost tx lama dilepas lebih dulu)',
	(await getPendingReserve(SENDER_C)).pendingAmount === COST_R2,
	`pending=${(await getPendingReserve(SENDER_C)).pendingAmount}`,
)

// Nonce yang sudah terisi diterima validator; slot berikutnya juga; nonce
// berlubang tetap ditolak.
const nonceOnly = (nonce: number): TxInterface =>
	({ from: SENDER_C, nonce }) as unknown as TxInterface
ok(
	'nonce 2 (sudah terisi) DITERIMA validator',
	(await validateTransactionNonce(nonceOnly(2))) === true,
)
ok(
	'nonce 3 = akun(2) + 1 pending DITERIMA validator',
	(await validateTransactionNonce(nonceOnly(3))) === true,
)
ok(
	'nonce 9 (berlubang) DITOLAK validator',
	(await validateTransactionNonce(nonceOnly(9))) === false,
)

// ---------------------------------------------------------------------------
// 4b. Cap per-pengirim di-skip untuk pengganti
// ---------------------------------------------------------------------------
//
// Cap adalah kebijakan node (`MAX_PENDING_PER_SENDER`). Pengganti menempati
// slot yang SUDAH ada, jadi jumlah pending tidak bertambah — kalau cap ikut
// dinilai, pengirim yang pas mentok tidak bisa mempercepat tx-nya sama
// sekali.

console.log('\nGROUP 4b — cap per-pengirim di-skip untuk pengganti:')

// Mnemonic BIP39 vektor uji (entropy 0xff×16) — kunci berbeda dari
// MNEMONIC di atas, jadi `from`-nya pengirim baru.
const zooKeys = generateKeysFromMnemonic(
	'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
)
const SENDER_D = generateAddressFromPublicKey(zooKeys.publicKey.slice(2))
await putAccount(SENDER_D, {
	address: SENDER_D,
	balance: 5_000_000,
	transactionCount: 0,
	isContract: false,
	lastTransactionDate: null,
	nonce: 0,
})

const dTxs: TxInterface[] = []
for (let i = 0; i < MAX_PENDING_PER_SENDER; i++)
	dTxs.push(buildRbf(zooKeys, SENDER_D, 100_000, 5_000, i))
let admitted = 0
for (const tx of dTxs) if ((await pool.addTransaction(tx)).isValid) admitted++
ok(
	`${MAX_PENDING_PER_SENDER} tx pending DITERIMA (pool tepat mentok cap)`,
	admitted === MAX_PENDING_PER_SENDER,
	`diterima=${admitted}`,
)
ok(
	'slot BERIKUTNYA (nonce 16) DITOLAK oleh cap',
	(await pool.addTransaction(buildRbf(zooKeys, SENDER_D, 100_000, 5_000, 16)))
		.isValid === false,
)
ok(
	'pengganti di nonce 0 TETAP DITERIMA walau cap sudah penuh',
	(await pool.addTransaction(buildRbf(zooKeys, SENDER_D, 100_000, 20_000, 0)))
		.isValid === true,
)
ok(
	'jumlah pending tetap tepat cap (pengganti tak menambah slot)',
	(await countPendingBySender(SENDER_D)) === MAX_PENDING_PER_SENDER,
)

// ---------------------------------------------------------------------------
// 5. Cap byte GLOBAL — evictasi laju-fee terendah, nonce tetap kontigu
// ---------------------------------------------------------------------------
//
// Cap adalah KEBIJAKAN node (bukan konsensus). Yang menyentuh konsensus
// adalah BENTUK evictasinya: selalu dari EKOR antrean pengirim (nonce
// tertinggi) dan selalu pengirim LAIN, sehingga antrean yang tersisa tetap
// kontigu — `verifyBlockNonceOrder` menolak blok dengan nonce berlubang, dan
// tx di belakang lubang tak akan pernah bisa ditambang.

console.log('\nGROUP 5 — cap byte global (evictasi laju-fee terendah):')

// Pool dibersihkan dulu: tx fiktif GROUP 2 (150+10) dan 16 tx SENDER_D GROUP
// 4b masih di sana, sedangkan cap diuji pada byte pool yang eksak.
for (const tx of await loadAllMempool()) await removeMemPool(tx.txHash!)
ok(
	'pool kosong sebelum uji cap (fixture lama dibersihkan)',
	(await loadAllMempool()).length === 0,
)
ok(
	`cap default menampung setidaknya satu blok (${MAX_MEMPOOL_WIRE_BYTES} byte)`,
	MAX_MEMPOOL_WIRE_BYTES >= 100 * 1000,
)

// Tx raksasa lewat jalur PRODUKSI (`MemPool.addTransaction`): butuh tanda
// tangan sah + akun bersaldo (SENDER_C, nonce 2 sesudah GROUP 3a/4), karena
// yang diuji di sini adalah WIRING cap ke admission, bukan rumusnya.
const buildCapTx = (
	amount: number,
	fee: number,
	nonce: number,
	data?: string,
): TxInterface => {
	const draft = createUnsignedTransaction(
		{
			amount,
			format: 'nexu',
			// `sender` hanya dipakai pemanggil untuk ambil nonce; tidak ikut tx.
			sender: SENDER_C,
			receiver: RECEIVER,
			fee,
			...(data === undefined ? {} : { data: stringToHex(data) }),
		},
		nonce,
	)
	if (!draft.status || !draft.tx) throw new Error('fixture cap gagal dibangun')
	return signTransaction(draft.tx, privateKey)
}

// Data 1,1 juta byte (hex 2,2 juta karakter) — pasti melewati cap. Fee =
// amount = 3 juta nexu supaya lantai laju-fee (1 nexu/byte) lolos, sehingga
// yang menolak benar-benar cap.
const raksasa = buildCapTx(3_000_000, 3_000_000, 2, 'f'.repeat(2_200_000))
ok(
	`tx raksasa ter-encode ${encodeTxPayload(raksasa).length} byte (> cap)`,
	encodeTxPayload(raksasa).length > MAX_MEMPOOL_WIRE_BYTES,
)
ok(
	'validator meloloskan tx raksasa (penolakan nanti datang dari cap)',
	(await transactionValidator(raksasa)) === true,
)
ok(
	'admission tx raksasa DITOLAK lewat jalur produksi (cap byte global)',
	(await pool.addTransaction(raksasa)).isValid === false,
)
ok(
	'tx raksasa tidak tersimpan (pool tetap kosong)',
	(await readMempoolEntry(raksasa.txHash!)) === undefined &&
		(await loadAllMempool()).length === 0,
)

// Fixture cap: `from` bebas (jalur cap hanya menyentuh storage — tak ada akun
// atau tanda tangan yang diverifikasi), tapi bentuknya harus ter-encode
// seperti tx nyata, sebab ukuran wire itulah yang dihitung cap.
const SENDER_E = `NxC${'e1'.repeat(20)}`
const SENDER_F = `NxC${'f2'.repeat(20)}`
const SENDER_G = `NxC${'12'.repeat(20)}`
const SENDER_H = `NxC${'b1'.repeat(20)}`
const capTx = (from: string, nonce: number, fee: number): TxInterface =>
	({
		from,
		txHash: `TxF${from.slice(-4)}${nonce.toString(16).padStart(16, '0')}${fee
			.toString(16)
			.padStart(16, '0')}`,
		nonce,
		amount: 1_000_000,
		fee,
		receiver: RECEIVER,
		sign: { v: 0, r: '0'.repeat(64), s: '0'.repeat(64) },
	}) as TxInterface

const sizeOf = (tx: TxInterface): number => encodeTxPayload(tx).length
const poolBytes = async (): Promise<number> =>
	(await loadAllMempool()).reduce((sum, tx) => sum + sizeOf(tx), 0)

const e0 = capTx(SENDER_E, 0, 9_000)
const e1 = capTx(SENDER_E, 1, 10)
const e2 = capTx(SENDER_E, 2, 20)
const f0 = capTx(SENDER_F, 0, 5_000)
ok(`fixture cap ter-encode (${sizeOf(e0)} byte)`, sizeOf(e0) > 0)
for (const tx of [e0, e1, e2, f0]) await saveMempool(tx)
const bytes4 = await poolBytes()

// E menahan tx TERMURAH di TENGAH antreannya (nonce 1, fee 10); F hanya satu
// tx tapi lebih mahal. Tx masuk G ber-laju jauh lebih tinggi. Cap dipasang
// tepat "cukup bila satu ekor E dibuang" — dan ekor E adalah nonce 2.
const g0 = capTx(SENDER_G, 0, 40_000)
const capSempit = bytes4 + sizeOf(g0) - sizeOf(e2)
ok(
	'evictasi DITERIMA: pemilik tx termurah (E) kehilangan EKOR-nya',
	(await enforceMempoolWireCap(g0, undefined, capSempit)) === true &&
		(await readMempoolEntry(e2.txHash!)) === undefined,
)
ok(
	'antrean E tetap KONTIGU (nonce 0 & 1 bertahan, nonce 2 hilang)',
	(await readMempoolEntry(e0.txHash!)) !== undefined &&
		(await readMempoolEntry(e1.txHash!)) !== undefined &&
		(await findPendingByNonce(SENDER_E, 2)) === undefined,
)
ok(
	'F (lebih mahal) tidak tersentuh',
	(await readMempoolEntry(f0.txHash!)) !== undefined,
)
const bytes3 = await poolBytes()
ok(
	`byte pool turun tepat satu tx (${bytes4} -> ${bytes3})`,
	bytes3 === bytes4 - sizeOf(e2),
)

// Tx masuk TERLALU MURAH: tak ada isi pool yang lebih murah untuk dibuang,
// jadi tak ada korban dan tx-nya ditolak — pool harus utuh.
const h0 = capTx(SENDER_H, 0, 5)
ok(
	'tx lebih murah dari seluruh isi pool DITOLAK (tanpa evictasi)',
	(await enforceMempoolWireCap(h0, undefined, bytes3)) === false,
)
ok(
	'pool utuh sesudah penolakan itu',
	(await poolBytes()) === bytes3 &&
		(await readMempoolEntry(e1.txHash!)) !== undefined &&
		(await readMempoolEntry(f0.txHash!)) !== undefined,
)

// Pengganti (RBF) tak ditolak hanya karena pool penuh: byte tx lama dilepas
// lebih dulu. Fixture sengaja sama lebar RLP-nya (9.000 vs 9.999 = 2 byte).
const e0b = capTx(SENDER_E, 0, 9_999)
ok(
	'premis RBF: pengganti berukuran wire sama dengan tx lama',
	sizeOf(e0b) === sizeOf(e0),
)
ok(
	'pengganti DITERIMA di pool yang persis penuh (tanpa evictasi)',
	(await enforceMempoolWireCap(e0b, e0, bytes3)) === true &&
		(await poolBytes()) === bytes3,
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
