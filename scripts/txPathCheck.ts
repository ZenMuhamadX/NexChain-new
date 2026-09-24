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
import { createUnsignedTransaction } from 'client/lib/createUnsignedTransaction'
import { signTransaction } from 'sign/signTransaction'
import { generateKeysFromMnemonic } from 'key/genKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'key/genAddrFromPubKey'
import { recoverSignerAddress } from 'sign/verifySIgnature'
import { validateTransactionSignature } from 'interface/module/isValidTxSign'
import { validateTransactionFees } from 'interface/module/isValidTxFee'
import { validateTransactionSenderReceiver } from 'interface/module/isValidTxSenderReciever'
import { createTxnHash } from 'nexchain/transaction/createTxHash'
import { setRpcUrl, getRpcUrl } from 'client/rpc-client/lib/rpcClient'
import { encodeTx } from 'nexchain/hex/tx/encodeTx'
import { decodeTx } from 'nexchain/hex/tx/decodeTx'
import { comTxInterface } from 'interface/structComTx'

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
	timestamp: 1790149112539,
	fee: 5000,
	extraMessage: 'check:tx',
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
	'recover signer == sender',
	recoverSignerAddress(tx.txHash!, tx.sign) === SNAPSHOT_ADDRESS,
)
ok('v membawa CHAIN_ID 26 (EIP-155)', tx.sign.v === 87 || tx.sign.v === 88)

// ---- 3. setara dengan logika inline lama (hash/r/s/hexInput identik) ----
ok(
	'txHash == createTxnHash(tx) (nonce ikut ter-hash)',
	tx.txHash === createTxnHash(tx),
)
ok('format dinormalisasi ke nexu', tx.format === 'nexu')
ok('amount dikonversi NXC -> nexu', tx.amount === 1e18)
ok('hexInput terisi', typeof tx.hexInput === 'string' && tx.hexInput.length > 0)

// ---- 4. signTransaction murni: tidak memutasi draft ----
const before = JSON.stringify(draft.tx)
signTransaction(draft.tx!, privateKey)
ok('signTransaction TIDAK memutasi input', JSON.stringify(draft.tx) === before)
ok(
	'draft unsigned masih ber-sign placeholder',
	draft.tx!.sign.r === '' && draft.tx!.sign.s === '' && draft.tx!.sign.v === 0,
)

// ---- 5. nonce berbeda -> txHash berbeda (anti-replay) ----
ok('nonce beda -> txHash beda', build(1).tx!.txHash !== build(0).tx!.txHash)

// ---- 6. encode/decode roundtrip utuh ----
const round = decodeTx(encodeTx(tx))
ok('encodeTx -> decodeTx identik', JSON.stringify(round) === JSON.stringify(tx))

// ---- 7. validasi signature murni: lolos & anti-forge ----
ok(
	'validateTransactionSignature menerima tx sendiri',
	await validateTransactionSignature(tx),
)
const attacker = generateKeysFromMnemonic(
	'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
).privateKey
const forged = signTransaction(build(0).tx!, attacker)
ok(
	'validateTransactionSignature MENOLAK tx yang ditandatangani pihak lain',
	(await validateTransactionSignature(forged)) === false,
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

// ---- 8. validator murni lain ----
ok('fee <= amount diterima', validateTransactionFees(tx))
ok(
	'sender == receiver ditolak',
	validateTransactionSenderReceiver({ ...tx, receiver: tx.sender }) === false,
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
