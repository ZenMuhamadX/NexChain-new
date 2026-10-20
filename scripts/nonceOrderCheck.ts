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
const { selectGapFreeTransactions, prioritizeByFeeRate, MAX_BLOCK_WIRE_BYTES } =
	await import('src/core/consensus/work')
const { loadMempool, loadAllMempool } =
	await import('src/core/state/storage/mempool/loadMempool')
const { encodeTxPayload } = await import('src/core/encoding/rlp/txCodec')
const { verifyBlockNonceOrder, isNonceMismatchError } =
	await import('src/core/consensus/verify/module/verifyNonce')
const { verifyStruct } =
	await import('src/core/consensus/verify/module/verifyStruct')
const { MAX_TX_PER_BLOCK } = await import('src/core/consensus/blockLimits')

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
		// r/s 32 byte huruf kecil supaya `encodeTxPayload` bisa menghitung
		// ukuran wire (dipakai seleksi berprioritas laju-fee); tanda tangan
		// tetap palsu — `commitBlock` tidak memeriksanya.
		sign: { v: 27, r: '01'.repeat(32), s: '02'.repeat(32) },
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
	const { prepareBlockForHashing } = await import('src/core/block/prepareBlock')
	const { createPowHasher } = await import('src/core/consensus/Pow')
	const { meetsDifficulty } = await import('src/core/consensus/difficulty')
	const { verifyPow } =
		await import('src/core/consensus/verify/module/verifyPow')
	const { verifyBlockHash } =
		await import('src/core/consensus/verify/module/verifyBlockHash')
	const { getCurrentBlock: getTip } =
		await import('src/core/block/query/onChain/block/getCurrentBlock')
	const { connectBlock } = await import('src/p2p/validation/connectBlock')

	const tipBefore = (await getTip()) as Block
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
	const tipAfter = (await getTip()) as Block
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
// GROUP 6 — prioritas laju-fee & cap byte (urutan nonce tetap)
// ---------------------------------------------------------------------------
console.log('\nGROUP 6 — prioritas laju-fee + cap byte:')

const SENDER_F = `NxC${'f7'.repeat(20)}`
const SENDER_G = `NxC${'8g'.repeat(20)}`
const SENDER_H = `NxC${'h9'.repeat(20)}`
await fund(SENDER_F)
await fund(SENDER_G)
{
	// Satu pengirim, dua tx: fee nonce-1 JAUH lebih tinggi. Fee tidak boleh
	// mereorder — nonce-1 hanya ikut bila nonce-0 juga masuk.
	const n0 = makeTx(SENDER_F, 0, 'fee', 10, 1)
	const n1 = makeTx(SENDER_F, 1, 'fee', 10, 5000)
	const s0 = encodeTxPayload(n0).length
	const s1 = encodeTxPayload(n1).length

	const one = prioritizeByFeeRate([n0, n1], s0)
	ok(
		'budget 1 slot → nonce-0 (fee lebih rendah) yang masuk',
		one.length === 1 && one[0].nonce === 0,
		`[${one.map((tx) => tx.nonce).join(',')}]`,
	)

	// Dua pengirim, satu slot: tx laju-fee tertinggi menang — antar-pengirim
	// memang tak punya kendala urutan.
	const gA = makeTx(SENDER_G, 0, 'fee', 10, 10)
	const gB = makeTx(SENDER_H, 0, 'fee', 10, 100)
	const winner = prioritizeByFeeRate([gA, gB], encodeTxPayload(gB).length)
	ok(
		'dua pengirim, budget 1 → fee-rate tertinggi',
		winner.length === 1 && winner[0].fee === 100,
		`[${winner.map((tx) => tx.fee).join(',')}]`,
	)

	// Dua tx: keduanya, tetap menaik — fee tidak mereorder.
	const two = prioritizeByFeeRate([n0, n1], s0 + s1)
	ok(
		'budget cukup 2 → [0,1] (fee tinggi tidak menyalip prasyarat)',
		two.length === 2 && two[0].nonce === 0 && two[1].nonce === 1,
		`[${two.map((tx) => tx.nonce).join(',')}]`,
	)
	const again = prioritizeByFeeRate([n0, n1], s0 + s1)
	ok(
		'urutan masukan sama → hasil sama (deterministik)',
		again.map((tx) => tx.txHash).join(',') ===
			two.map((tx) => tx.txHash).join(','),
	)

	// Determinisme antar-pengirim: fee-rate IDENTIK → diputus `txHash`, jadi
	// pemenang sama walau urutan masukan antar-pengirim dibalik.
	const tA = makeTx(SENDER_G, 0, 'tie', 10, 7)
	const tB = makeTx(SENDER_H, 0, 'tie', 10, 7)
	const tieHashes = [tA.txHash ?? '', tB.txHash ?? ''].sort()
	const pickAB = prioritizeByFeeRate([tA, tB], encodeTxPayload(tA).length)
	const pickBA = prioritizeByFeeRate([tB, tA], encodeTxPayload(tB).length)
	ok(
		'seri fee-rate diputus txHash (deterministik)',
		pickAB.length === 1 &&
			pickBA.length === 1 &&
			pickAB[0].txHash === pickBA[0].txHash &&
			pickAB[0].txHash === tieHashes[0],
	)

	// Bacaan template TIDAK lagi terpotong 100 global; bacaan tampilan tetap.
	const many = `NxC${'99'.repeat(20)}`
	for (let i = 0; i < 150; i++) await saveMempool(makeTx(many, i, 'cap', 10, 5))
	const all = await loadAllMempool()
	const capped = await loadMempool()
	ok(
		`loadAllMempool (template) tak terpotong — ${all.length} entri`,
		all.length > 100,
	)
	ok(
		`loadMempool (${capped.length}) tetap 100 untuk tampilan`,
		capped.length === 100,
	)

	// Ujung-ke-ujung: blok dari hasil seleksi tetap bebas-gap → diterima
	// `commitBlock` (fee tinggi tak merusak urutan nonce).
	const FUNDED = `NxC${'77'.repeat(20)}`
	await fund(FUNDED)
	const built = prioritizeByFeeRate(
		[makeTx(FUNDED, 0, 'e2e', 10, 3), makeTx(FUNDED, 1, 'e2e', 10, 900)],
		10_000,
	)
	const accepted = await commitTxs(built)
	const after = await snapshot(FUNDED)
	ok('blok hasil seleksi laju-fee DITERIMA', accepted === true)
	ok('nonce pengirim maju 2', after.nonce === 2, `nonce=${after.nonce}`)

	// A4: `size` = Σ byte wire tx pengguna — satuan yang sama dengan anggaran
	// `MAX_BLOCK_WIRE_BYTES`, sehingga plafon itu berlaku by construction.
	const sumWire = built.reduce((n, tx) => n + encodeTxPayload(tx).length, 0)
	const sized = await createBlockTemplate(built, MINER)
	ok(
		'template.size = Σ encodeTxPayload(tx)',
		sized.block.size === sumWire,
		`[${sized.block.size} vs ${sumWire}]`,
	)
	ok(
		`template.size ≤ MAX_BLOCK_WIRE_BYTES (${MAX_BLOCK_WIRE_BYTES})`,
		sized.block.size > 0 && sized.block.size <= MAX_BLOCK_WIRE_BYTES,
		`[${sized.block.size}]`,
	)
	const empty = await createBlockTemplate([], MINER)
	ok(
		'template tanpa tx → size 0',
		empty.block.size === 0,
		`[${empty.block.size}]`,
	)

	// C1 (konsensus baru): plafon ukuran/jumlah tx + `size` wajib = Σ byte
	// wire isinya. Blok uji di bawah dibuat lolos semua cek lain — hanya
	// aturan C1 yang menilai. DUA catatan pola:
	//   - template MENTAH ber-`hash` kosong, dan `Joi.string().required()`
	//     menolak string kosong (berlaku sejak sebelum C1 juga) — jadi setiap
	//     clone diuji dengan hash palsu 64-hex; `verifyStruct` hanya menuntut
	//     hash TERSEDIA, bukan benar (kebenaran = `verifyBlockHash`);
	//   - log error yang muncul di console selama blok ini berjalan adalah
	//     DIHARAPKAN (penolakan disengaja, pola sama dengan kontrol negatif
	//     di `scripts/reorgCheck.ts`).
	const C1_SENDER = `NxC${'42'.repeat(20)}`
	const structBase = JSON.parse(JSON.stringify(sized)) as Block
	structBase.block.header.hash = hex64(0xc1a1)
	ok(
		'C1: template dengan hash terisi LULUS verifyStruct',
		await verifyStruct(structBase),
	)

	const badSum = JSON.parse(JSON.stringify(structBase)) as Block
	badSum.block.size = structBase.block.size + 1
	ok('C1: size ≠ Σ byte wire DITOLAK', (await verifyStruct(badSum)) === false)

	const frac = JSON.parse(JSON.stringify(structBase)) as Block
	frac.block.size = structBase.block.size + 0.5
	ok(
		'C1: size pecahan (non-bulat) DITOLAK',
		(await verifyStruct(frac)) === false,
	)

	// Template kosong + hash = baseline sah; menaikkan size-nya melanggar
	// HANYA plafon — penolakannya murni aturan cap.
	const baseEmpty = JSON.parse(JSON.stringify(empty)) as Block
	baseEmpty.block.header.hash = hex64(0xc1a2)
	ok(
		'C1: template kosong (hash terisi) LULUS verifyStruct',
		await verifyStruct(baseEmpty),
	)
	const over = JSON.parse(JSON.stringify(baseEmpty)) as Block
	over.block.size = MAX_BLOCK_WIRE_BYTES + 1
	ok(
		'C1: size > MAX_BLOCK_WIRE_BYTES DITOLAK',
		(await verifyStruct(over)) === false,
	)

	// 1.001 tx dengan size = Σ-nya sendiri (equality lolos): satu-satunya
	// pelanggaran = plafon jumlah tx.
	const tooMany = Array.from({ length: MAX_TX_PER_BLOCK + 1 }, (_, i) =>
		makeTx(C1_SENDER, i, 'cap'),
	)
	const bloated = JSON.parse(JSON.stringify(baseEmpty)) as Block
	bloated.block.transactions = tooMany
	bloated.block.size = tooMany.reduce(
		(n, tx) => n + encodeTxPayload(tx).length,
		0,
	)
	ok(
		`C1: ${MAX_TX_PER_BLOCK + 1} tx DITOLAK (plafon jumlah)`,
		(await verifyStruct(bloated)) === false,
	)

	// Tepat di batas: 1.000 tx dengan size = Σ → LULUS (cap tidak kelewat
	// ketat untuk himpunan yang sah).
	const atCap = Array.from({ length: MAX_TX_PER_BLOCK }, (_, i) =>
		makeTx(C1_SENDER, i, 'cap'),
	)
	const full = JSON.parse(JSON.stringify(baseEmpty)) as Block
	full.block.transactions = atCap
	full.block.size = atCap.reduce((n, tx) => n + encodeTxPayload(tx).length, 0)
	ok(
		`C1: tepat ${MAX_TX_PER_BLOCK} tx dengan size = Σ LULUS`,
		await verifyStruct(full),
	)

	// Cap seleksi: 1.005 tx kandidat → hanya 1.000 yang dipilih. Budget byte
	// dimundurkan supaya satu-satunya pemotong adalah plafon jumlah (bukan
	// anggaran byte) — dan dipotong di antrean pengirim, jadi kontiguitas
	// nonce tetap utuh.
	const flood = Array.from({ length: MAX_TX_PER_BLOCK + 5 }, (_, i) =>
		makeTx(C1_SENDER, i, 'sel'),
	)
	const selected = prioritizeByFeeRate(flood, 10_000_000)
	ok(
		`C1: seleksi berprioritas berhenti di ${MAX_TX_PER_BLOCK} tx`,
		selected.length === MAX_TX_PER_BLOCK,
		`[${selected.length}]`,
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
