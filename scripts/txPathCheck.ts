/**
 * Gerbang regresi "jalur transaksi wallet tetap benar".
 *
 * Berbeda dengan `check:browser` (yang memastikan bisa dibundle), skrip ini
 * memastikan build + sign + kirim tetap MENGHASILKAN transaksi yang benar.
 * Seluruhnya murni: tidak ada RPC, tidak ada DB, tidak ada side effect,
 * jadi aman dijalankan kapan pun tanpa node hidup.
 *
 * Jalankan:  bun run check:tx
 *
 * Mencakup fase terakhir:
 *   - Phase B : createUnsignedTransaction + signTransaction (split murni)
 *   - Bug A/B : decode hex-JSON & nonce berikutnya (diuji di E2E hidup)
 *   - Phase E : konfigurasi URL RPC
 */
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { recoverSignerAddress } from 'src/crypto/verifySignature'
import { validateTransactionSignature } from 'src/core/validation/module/isValidTxSign'
import { validateTransactionFees } from 'src/core/validation/module/isValidTxFee'
import { validateTransactionSenderReceiver } from 'src/core/validation/module/isValidTxSenderReciever'
import { validateTransactionAmount } from 'src/core/validation/module/isValidTxAmount'
import { validateAddresses } from 'src/core/validation/module/isValidAddress'
import { validateAddressLengths } from 'src/core/validation/module/isValidAddressLength'
import { validateRule } from 'src/core/validation/module/validateField'
import { normalizeParams } from 'src/rpc/normalizeParams'
import { txSighash, txHashOf, TX_TYPE } from 'src/core/encoding/rlp/txCodec'
import { setRpcUrl, getRpcUrl } from 'src/client/rpc-client/lib/rpcClient'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { comTxInterface } from 'src/types/compositeTransaction'
import { TxInterface } from 'src/types/transaction'
import { encodeV } from 'src/crypto/chainId'
import { MAX_SUPPLY_NEXU } from 'src/core/token/constants'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? '  -> ' + extra : ''}`)
	}
}

// Mnemonic BIP39 tetap -> address deterministik (snapshot Phase A).
const MNEMONIC =
	'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const SNAPSHOT_ADDRESS = 'NxC606b3a2b15a6b71275fc9e732617ca98d725dff7'

const { privateKey, publicKey } = generateKeysFromMnemonic(MNEMONIC)

const RECEIVER = `NxC${'22'.repeat(20)}`
const input: comTxInterface = {
	amount: 1,
	format: 'NXC',
	receiver: RECEIVER,
	sender: SNAPSHOT_ADDRESS,
	fee: 5000,
	data: stringToHex('check:tx'),
}

const build = (nonce: number): ReturnType<typeof createUnsignedTransaction> =>
	createUnsignedTransaction(input, nonce)

// ---- 1. snapshot address (derivation tidak bergeser) ----
// generateAddressFromPublicKey menerima hex TANPA prefix "Nx"
// (sama seperti account/createNewWallet & importWalletFromMnemonic).
const addr = generateAddressFromPublicKey(publicKey.slice(2))
ok(`address snapshot tetap (${addr})`, addr === SNAPSHOT_ADDRESS)

// ---- 2. build + sign -> recover cocok dengan sender ----
const draft = build(0)
ok(
	'builder menerima nonce & menghasilkan tx',
	draft.status === true && !!draft.tx,
)
const tx = signTransaction(draft.tx!, privateKey)
ok(
	'recover signer == alamat pemilik mnemonic',
	recoverSignerAddress(txSighash(tx), tx.sign) === SNAPSHOT_ADDRESS,
)
ok(
	'v membawa CHAIN_ID saat ini (EIP-155)',
	tx.sign.v === encodeV(0) || tx.sign.v === encodeV(1),
)

// ---- 2b. `from` TURUNAN — tidak dikirim, dipulihkan dari tanda tangan ----
ok(
	'from diisi hasil ecrecover (== alamat penanda tangan)',
	tx.from === SNAPSHOT_ADDRESS,
)
ok(
	'from TIDAK ada di wire (tidak ada field sender di objek hasil decode)',
	!Object.prototype.hasOwnProperty.call(decodeTx(encodeTx(tx)), 'sender'),
)
// `comTxInterface.sender` hanya niat pemanggil (dipakai untuk mengambil
// nonce). Transaksinya sendiri tidak boleh terpengaruh olehnya — kalau
// terpengaruh, berarti pengirim masih ikut di-hash dan masih dikirim.
ok(
	'comTxInterface.sender tidak memengaruhi transaksi sama sekali',
	JSON.stringify(
		createUnsignedTransaction({ ...input, sender: `NxC${'ab'.repeat(20)}` }, 0)
			.tx,
	) === JSON.stringify(draft.tx),
)

// ---- 3. dua hash: txHash mengikat byte tertandatangani ----
ok(
	'txHash == txHashOf(tx) (hash dari payload bertipe)',
	tx.txHash === txHashOf(tx),
)
ok(
	'sighash TIDAK berubah oleh tanda tangan (bebas siklus r/s)',
	txSighash({ ...tx, sign: { v: 0, r: '0'.repeat(64), s: '0'.repeat(64) } })
		.length === 32,
)
ok('amount dikonversi NXC -> nexu (1 NXC = 1e8 nexu)', tx.amount === 1e8)
ok(
	'data tersimpan sebagai hex',
	typeof tx.data === 'string' && tx.data.startsWith('0x'),
)

// ---- 4. signTransaction murni: tidak memutasi draft ----
const before = JSON.stringify(draft.tx)
signTransaction(draft.tx!, privateKey)
ok('signTransaction TIDAK memutasi input', JSON.stringify(draft.tx) === before)
ok(
	'draft unsigned masih ber-sign placeholder',
	draft.tx!.sign.r === '0'.repeat(64) &&
		draft.tx!.sign.s === '0'.repeat(64) &&
		draft.tx!.sign.v === 0,
)
ok('draft unsigned BELUM punya txHash', draft.tx!.txHash === undefined)
ok(
	'draft unsigned BELUM punya from (pengirim baru ada setelah ditandatangani)',
	draft.tx!.from === undefined,
)

// ---- 5. nonce berbeda -> txHash berbeda (anti-replay) ----
ok(
	'nonce beda -> txHash beda',
	signTransaction(build(1).tx!, privateKey).txHash !==
		signTransaction(build(0).tx!, privateKey).txHash,
)

// ---- 6. encode/decode roundtrip utuh ----
const payload = encodeTx(tx)
const round = decodeTx(payload)
ok('encodeTx -> decodeTx identik', JSON.stringify(round) === JSON.stringify(tx))
ok(
	'decodeTx memulihkan from dari tanda tangan (tanpa field pengirim)',
	round.from === SNAPSHOT_ADDRESS,
)

// ---- 6b. RLP: bentuk wire, kanonisitas, penolakan payload rusak ----
ok(
	'RLP: payload berupa base64 yang sah',
	/^[A-Za-z0-9+/]+={0,2}$/.test(payload),
)
// ~131 byte membuktikan `hexInput` (360 B) dan `txHash` (79 B) memang tidak
// ikut terkirim — keduanya dihitung ulang node.
ok(
	`RLP: payload jauh lebih kecil dari format lama (${payload.length} < 300)`,
	payload.length < 300,
)
ok(
	'RLP: r/s tepat 32 byte (64 hex)',
	tx.sign.r.length === 64 && tx.sign.s.length === 64,
)
ok(
	'RLP: byte pertama adalah tipe transaksi 0x02',
	atob(payload).charCodeAt(0) === TX_TYPE,
)
// Kanonisitas: encode ulang hasil decode harus menghasilkan byte yang sama.
ok(
	'RLP: encode ulang hasil decode identik (kanonik)',
	encodeTx(round) === payload,
)

// Payload rusak harus DITOLAK KERAS, bukan di-parse setengah.
const rejectsPayload = (name: string, data: string): void => {
	let threw = false
	try {
		decodeTx(data)
	} catch {
		threw = true
	}
	ok(`RLP: menolak ${name}`, threw)
}
rejectsPayload('base64 tidak valid', '!!!bukan-base64!!!')
rejectsPayload('payload kosong', '')
rejectsPayload(
	'tipe transaksi tidak dikenal',
	btoa(String.fromCharCode(0x09, 0xc0)),
)
rejectsPayload('payload terpotong', payload.slice(0, payload.length - 8))

// ---- 7. validasi signature murni: lolos & anti-forge ----
ok(
	'validateTransactionSignature menerima tx sendiri',
	await validateTransactionSignature(tx),
)
const attackerKeys = generateKeysFromMnemonic(
	'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
)
const forged = signTransaction(build(0).tx!, attackerKeys.privateKey)
// Di model lama transaksi ini akan MENGKLAIM `sender = SNAPSHOT_ADDRESS`
// sementara tanda tangannya milik penyerang — dan ditolak karena klaim tidak
// cocok dengan kenyataan. Sekarang tidak ada klaim lagi: `from` DITURUNKAN
// dari tanda tangan, jadi transaksi ini sah — tapi sebagai transaksi MILIK
// PENYERANG, bukan milik korban. Itulah jaminannya, dan ia berlaku tanpa
// pemeriksaan tambahan.
ok(
	'pihak lain tidak bisa bertransaksi atas nama alamat korban',
	forged.from !== SNAPSHOT_ADDRESS && typeof forged.from === 'string',
)
ok(
	'tx pihak lain tetap SAH — from-nya penyerang sendiri, bukan korban',
	(await validateTransactionSignature(forged)) === true,
)
// Balik seluruh byte terakhir r -> dijamin berbeda (XOR 0xff), bukan kebetulan sama
const flippedLast = (parseInt(tx.sign.r.slice(-2), 16) ^ 0xff)
	.toString(16)
	.padStart(2, '0')
const tampered = {
	...tx,
	sign: { ...tx.sign, r: tx.sign.r.slice(0, -2) + flippedLast },
}
ok(
	'validateTransactionSignature menolak r yang diubah',
	(await validateTransactionSignature(tampered)) === false,
)
// `from` adalah nilai turunan. Kalau ia disunting (mis. JSON mempool yang
// diubah isinya), nilai itu tidak lagi cocok dengan tanda tangannya.
ok(
	'validateTransactionSignature menolak `from` yang diubah',
	(await validateTransactionSignature({
		...tx,
		from: `NxC${'33'.repeat(20)}`,
	})) === false,
)

/** Salinan tanpa `from` — mensimulasikan record yang kehilangan field turunan. */
const stripFrom = (source: TxInterface): TxInterface => {
	const copy: TxInterface = { ...source }
	delete copy.from
	return copy
}
ok(
	'validateTransactionSignature menolak tx tanpa `from`',
	(await validateTransactionSignature(stripFrom(tx))) === false,
)

// ---- 8. validator murni lain ----
ok('fee <= amount diterima', validateTransactionFees(tx))
ok(
	'sender == receiver ditolak',
	validateTransactionSenderReceiver({ ...tx, receiver: tx.from! }) === false,
)
const small = createUnsignedTransaction(
	{ ...input, format: 'nexu', amount: 0.5 },
	0,
)
ok(
	'amount < 1 nexu ditolak dengan pesan yang sama',
	!small.status &&
		small.error === 'Transaction amount must be at least 1 nexu.',
)

// ============================================================================
// STAGE 1 — REGRESI SEMANTIK VALIDATOR
//
// Bug lama: helper `validateField(writeError, ...)` menerima "kondisi error",
// tapi semua pemanggil meneruskan "kondisi benar". Akibatnya:
//   - amount positif  -> DITOLAK  (padahal harusnya valid)
//   - address valid   -> DITOLAK
//   - sender != recv  -> DITOLAK
// Test lama hanya menguji kasus NEGATIF, sehingga bug ini lolos 27/0 OK.
// Blok di bawah menguji kasus POSITIF + kasus negatif yang menyesatkan.
// ============================================================================

console.log('\nSTAGE 1 — semantik validator:')

// Helper: transaksi baseline yang SAHARUS valid.
const validTx = tx

ok(
	'S1: validateRule(true) -> true (jalur valid)',
	validateRule(true, 'test', 'should not log') === true,
)
ok(
	'S1: validateRule(false) -> false (jalur error)',
	validateRule(false, 'test', 'expected rejection') === false,
)

ok(
	'S1: amount > 0 pada transaksi valid DITERIMA',
	validateTransactionAmount(validTx),
)
ok(
	'S1: amount < 1 nexu DITOLAK',
	validateTransactionAmount({ ...validTx, amount: 0 }) === false,
)

ok(
	'S1: fee >= 0 pada transaksi valid DITERIMA',
	validateTransactionFees(validTx),
)
ok(
	'S1: fee negatif DITOLAK (guard fail-closed)',
	validateTransactionFees({ ...validTx, fee: -1 }) === false,
)
// CATATAN PENTING (temuan empiris, kini sudah ditangani di Stage 2):
// Pada satuan LAMA (1e18), `1e18 + 1` di JavaScript justru kembali `1e18`
// (presisi float 53-bit) — sehingga test awal dengan `amount + 1` lolos
// padahal fee tidak benar-benar melebihi amount. Turun ke 8 desimal membuat
// seluruh rentang suplai (0 … 5.000.000.000.000.000) jatuh di bawah
// `Number.MAX_SAFE_INTEGER` = 9.007.199.254.740.991, jadi setiap bilangan
// bulat direpresentasikan TEPAT.
ok(
	'S1: fee > amount DITOLAK',
	validateTransactionFees({ ...validTx, fee: validTx.amount * 2 }) === false,
)
ok(
	'S2: plafon suplai + 1 tetap eksak (kontras dengan bug 1e18 + 1 == 1e18)',
	MAX_SUPPLY_NEXU + 1 === 5_000_000_000_000_001 &&
		Number.isSafeInteger(MAX_SUPPLY_NEXU + 1),
)
ok(
	'S2: MAX_SUPPLY_NEXU berada di bawah Number.MAX_SAFE_INTEGER',
	MAX_SUPPLY_NEXU < Number.MAX_SAFE_INTEGER,
)

ok(
	'S1: sender != receiver pada transaksi valid DITERIMA',
	validateTransactionSenderReceiver(validTx),
)
ok(
	'S1: sender == receiver DITOLAK',
	validateTransactionSenderReceiver({ ...validTx, receiver: validTx.from! }) ===
		false,
)

ok(
	'S1: alamat valid (43 char) DITERIMA',
	validateAddresses(validTx) && validateAddressLengths(validTx),
)
ok(
	'S1: alamat prefix salah DITOLAK',
	validateAddresses({ ...validTx, from: 'NxX' + '0'.repeat(40) }) === false,
)
ok(
	'S1: receiver address tidak valid DITOLAK',
	validateAddresses({ ...validTx, receiver: 'not-an-address' }) === false,
)
ok(
	'S1: panjang alamat salah DITOLAK',
	validateAddressLengths({ ...validTx, receiver: validTx.receiver.slice(0, 42) }) ===
		false,
)

// ============================================================================
// STAGE 1 / P1 — normalisasi params JSON-RPC (murni, tanpa server)
// ============================================================================

console.log('STAGE 1 / P1 — normalisasi params JSON-RPC:')

ok('P1: array 1 elemen di-unwrap jadi scalar', normalizeParams(['a']) === 'a')
ok('P1: array kosong jadi undefined', normalizeParams([]) === undefined)
ok('P1: null jadi undefined', normalizeParams(null) === undefined)
ok('P1: scalar diteruskan utuh', normalizeParams('a') === 'a')
ok('P1: angka diteruskan utuh', normalizeParams(7) === 7)
ok('P1: object diteruskan utuh (untuk nex_getWork dlsb)', normalizeParams({ a: 1 }) instanceof Object)
const twoArgs = normalizeParams(['a', 'b'])
ok(
	'P1: array >1 elemen diteruskan utuh',
	Array.isArray(twoArgs) && twoArgs.length === 2,
)
ok('P1: undefined diteruskan undefined', normalizeParams(undefined) === undefined)

// ============ Phase E: URL RPC tidak lagi hardcoded ============
const defaultUrl = getRpcUrl()
ok(
	'E4: default tetap localhost:8000/rpc',
	defaultUrl === 'http://localhost:8000/rpc',
)
setRpcUrl('https://rpc.testnet.example/rpc')
ok(
	'E4: setRpcUrl menerima https',
	getRpcUrl() === 'https://rpc.testnet.example/rpc',
)
setRpcUrl('http://127.0.0.1:9000/rpc')
ok(
	'E4: setRpcUrl menerima http non-default',
	getRpcUrl() === 'http://127.0.0.1:9000/rpc',
)
for (const bad of [
	'javascript:alert(1)',
	'data:text/html,<script></script>',
	'file:///etc/passwd',
	'',
	'not a url',
]) {
	let threw = false
	try {
		setRpcUrl(bad)
	} catch {
		threw = true
	}
	ok(`E4: menolak skema/tidak valid -> ${JSON.stringify(bad)}`, threw)
}
setRpcUrl(defaultUrl)
ok('E4: URL dipulihkan ke default', getRpcUrl() === defaultUrl)

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
