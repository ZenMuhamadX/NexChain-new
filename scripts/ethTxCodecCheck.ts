/**
 * Gate offline untuk transaksi Ethereum (`0x03`) yang diterima node.
 *
 * Jalankan:  bun run check:ethTx
 *
 * Vektor dibuat dengan `elliptic` (bukan salinan kode produksi): digest dan
 * RLP disusun di sini, lalu hasil decode/validasi node yang diuji.
 */
import { ec as EC } from 'elliptic'
import { keccak256 } from 'js-sha3'
import { CHAIN_ID } from '../src/crypto/chainId'
import { sha256 } from '../src/core/encoding/sha256'
import { TX_HASH_PREFIX } from '../src/core/encoding/rlp/txHash'
import {
	TX_TYPE,
	encodeTxPayload,
	decodeTxPayload,
} from '../src/core/encoding/rlp/txCodec'
import { ETH_TX_TYPE, ethTxSighash } from '../src/core/encoding/rlp/ethTxCodec'
import { rlpEncode } from '../src/core/encoding/rlp/rlpEncode'
import { numberToBytes } from '../src/core/encoding/rlp/codecScalars'
import { validateTransactionSignature } from '../src/core/validation/module/isValidTxSign'
import { txInterfaceValidator } from '../src/core/validation/joi/txInterface'
import { Block } from '../src/core/block/blockModel'
import { verifyStruct } from '../src/core/consensus/verify/module/verifyStruct'

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
const throws = (fn: () => unknown): boolean => {
	try {
		fn()
		return false
	} catch {
		return true
	}
}

const ec = new EC('secp256k1')
const key = ec.keyFromPrivate(
	'4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
	'hex',
)
const uncompressed = key.getPublic(false, 'hex')
const ethFrom = `0x${keccak256(Buffer.from(uncompressed.slice(2), 'hex')).slice(-40)}`
const expectedFrom = `NxC${ethFrom.slice(2)}`
const to = new Uint8Array(20).fill(0xab)
const expectedReceiver = `NxC${'ab'.repeat(20)}`
const WEI_PER_NEXU = 10n ** 10n
const nonce = 7
const gasPrice = 10n ** 10n
const gasLimit = 21000n
const value = 5n * WEI_PER_NEXU

/** Vektor memakai serializer BigInt sendiri, bukan salinan kode produksi. */
const bigBytes = (value: bigint): Uint8Array => {
	if (value === 0n) return new Uint8Array(0)
	const hex = value.toString(16)
	return new Uint8Array(
		Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, 'hex'),
	)
}

const preimage = (chainId: number, amount = value): Uint8Array =>
	rlpEncode([
		numberToBytes(nonce, 'nonce'),
		bigBytes(gasPrice),
		bigBytes(gasLimit),
		to,
		bigBytes(amount),
		new Uint8Array(0),
		numberToBytes(chainId, 'chainId'),
		new Uint8Array(0),
		new Uint8Array(0),
	])

const buildRaw = (chainId: number, amount = value): Uint8Array => {
	const digest = new Uint8Array(Buffer.from(keccak256(preimage(chainId, amount)), 'hex'))
	const sig = ec.sign(digest, key, { canonical: true })
	const v = (sig.recoveryParam ?? 0) + chainId * 2 + 35
	return rlpEncode([
		numberToBytes(nonce, 'nonce'),
		bigBytes(gasPrice),
		bigBytes(gasLimit),
		to,
		bigBytes(amount),
		new Uint8Array(0),
		numberToBytes(v, 'v'),
		new Uint8Array(Buffer.from(sig.r.toString(16, 64), 'hex')),
		new Uint8Array(Buffer.from(sig.s.toString(16, 64), 'hex')),
	])
}

console.log('GROUP 1 — decode tipe 0x03:')
const raw = buildRaw(CHAIN_ID)
const payload = new Uint8Array(raw.length + 1)
payload[0] = ETH_TX_TYPE
payload.set(raw, 1)
const tx = decodeTxPayload(payload)
ok('byte tipe terbaca', tx.type === ETH_TX_TYPE)
ok('dari signature → alamat bridge', tx.from === expectedFrom, `${tx.from}`)
ok('to 20 byte → NxC tanpa konversi', tx.receiver === expectedReceiver)
ok('jumlah wei → nexu eksak', tx.amount === 5)
ok('fee = gasPrice × gasLimit / 10^10', tx.fee === 21000)
ok(
	'txHash tetap TxC + sha256(payload)',
	tx.txHash === TX_HASH_PREFIX + (sha256(payload, 'hex') as string),
)
ok(
	'encode ulang identik dengan payload',
	Buffer.from(encodeTxPayload(tx)).toString('hex') ===
		Buffer.from(payload).toString('hex'),
)
ok(
	'sighash = keccak preimage EIP-155',
	Buffer.from(ethTxSighash(raw)).toString('hex') ===
		keccak256(preimage(CHAIN_ID)),
)
ok('tanda tangan lolos validasi node', await validateTransactionSignature(tx))

console.log('GROUP 2 — penolakan:')
ok(
	'chainId asing ditolak',
	throws(() => decodeTxPayload(buildRaw(CHAIN_ID + 1, value))),
)
ok(
	'wei tidak habis dibagi ditolak',
	throws(() => decodeTxPayload(buildRaw(CHAIN_ID, 1n))),
)
ok(
	'RLP bukan 9 item ditolak',
	throws(() =>
		decodeTxPayload(new Uint8Array([ETH_TX_TYPE, 0xc0])),
	),
)
const order = BigInt(`0x${ec.curve.n.toString(16)}`)
const sig = ec.sign(
	new Uint8Array(Buffer.from(keccak256(preimage(CHAIN_ID)), 'hex')),
	key,
	{ canonical: true },
)
const sHex = sig.s.toString(16).padStart(64, '0')
const highS = (order - BigInt(`0x${sHex}`)).toString(16).padStart(64, '0')
const highRaw = rlpEncode([
	numberToBytes(nonce, 'nonce'),
	bigBytes(gasPrice),
	bigBytes(gasLimit),
	to,
	bigBytes(value),
	new Uint8Array(0),
	numberToBytes(
		(sig.recoveryParam ?? 0) + CHAIN_ID * 2 + 35 + 1,
		'v',
	),
	new Uint8Array(Buffer.from(sig.r.toString(16, 64), 'hex')),
	new Uint8Array(Buffer.from(highS, 'hex')),
])
const highPayload = new Uint8Array(highRaw.length + 1)
highPayload[0] = ETH_TX_TYPE
highPayload.set(highRaw, 1)
ok('high-S (EIP-2) ditolak', !(await validateTransactionSignature(decodeTxPayload(highPayload))))

console.log('GROUP 3 — nilai wei besar (MetaMask 18 desimal):')
for (const [label, wei, nexu] of [
	['1 NXC', 10n ** 18n, 100_000_000],
	['1000 NXC', 1000n * 10n ** 18n, 100_000_000_000],
] as const) {
	const bigRaw = buildRaw(CHAIN_ID, wei)
	const bigPayload = new Uint8Array(bigRaw.length + 1)
	bigPayload[0] = ETH_TX_TYPE
	bigPayload.set(bigRaw, 1)
	const bigTx = decodeTxPayload(bigPayload)
	ok(`${label}: amount nexu eksak`, bigTx.amount === nexu, `${bigTx.amount}`)
	ok(
		`${label}: sighash keccak sesuai`,
		Buffer.from(ethTxSighash(bigRaw)).toString('hex') ===
			keccak256(preimage(CHAIN_ID, wei)),
	)
	ok(
		`${label}: encode ulang identik`,
		Buffer.from(encodeTxPayload(bigTx)).toString('hex') ===
			Buffer.from(bigPayload).toString('hex'),
	)
	ok(`${label}: tanda tangan valid`, await validateTransactionSignature(bigTx))
	ok(
		`${label}: lolos skema Joi`,
		txInterfaceValidator.validate(bigTx).error === undefined,
		txInterfaceValidator.validate(bigTx).error?.message,
	)
}

console.log('GROUP 4 — skema Joi untuk field tx 0x03:')
const joiError = (value: unknown): string | undefined =>
	txInterfaceValidator.validate(value).error?.message
ok('tx 0x03 lengkap diterima', joiError(tx) === undefined, joiError(tx))
ok('raw wajib untuk tipe 0x03', joiError({ ...tx, raw: undefined }) !== undefined)
ok('tipe asing ditolak', joiError({ ...tx, type: 0x04 }) !== undefined)
ok(
	'raw dilarang untuk tipe 0x02',
	joiError({ ...tx, type: TX_TYPE }) !== undefined,
)
ok('key acak tetap ditolak', joiError({ ...tx, foo: 1 }) !== undefined)

console.log('GROUP 5 — verifikasi struktur blok berisi tx 0x03:')
const ethBlock = new Block({
	header: {
		previousBlockHash: '0'.repeat(64),
		timestamp: 1,
		hash: 'a'.repeat(64),
		nonce: 0,
		version: '1',
		difficulty: 20,
		stateRoot: 'b'.repeat(64),
	},
	height: 1,
	chainId: CHAIN_ID,
	size: encodeTxPayload(tx).length,
	merkleRoot: tx.txHash,
	minerId: expectedReceiver,
	blockReward: 0,
	totalReward: 0,
	status: 'confirmed',
	coinbaseTransaction: { receiver: expectedReceiver, amount: 0 },
	transactions: [tx],
} as never)
ok('blok dengan tx 0x03 lolos verifyStruct', await verifyStruct(ethBlock))

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
