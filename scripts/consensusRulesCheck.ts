/**
 * Gerbang regresi "aturan konsensus P0-A".
 *
 * Jalankan:  bun run check:consensus
 *
 * Tiga aturan yang dicegah regresi di sini:
 *
 *   1. **Low-S (EIP-2)** — `recoverPublicKey` menolak signature `s > n/2`
 *      (dan `s < 1`, `s > n-1`). Tanpa ini transaksi bisa di-malleate:
 *      satu niat kirim menghasilkan dua `txHash` berbeda, dan setiap
 *      pemulihan (`txFrom`, validasi signature) menerima dua bentuk untuk
 *      satu fakta yang sama.
 *   2. **Hadiah/fee blok** — `verifyBlockReward` direhitung penuh dari
 *      `cutBlockReward`/`calculateTotalFees`/`GAS_PRICE_NEXU`/
 *      `calculateTotalBlockReward`; field blok TIDAK dipercaya. Setiap
 *      field yang dimanipulasi (totalReward, blockReward, coinbase,
 *      receiver, fees, gasPrice) harus menghasilkan penolakan, dan genesis
 *      tetap exempt.
 *   3. **Timestamp MTP-11 + batas masa depan** — `checkBlockTimestamp`
 *      menolak timestamp `<=` median 11 blok sebelumnya dan timestamp
 *      lebih dari 2 jam ke depan; daftar kosong = hanya cek masa depan
 *      (genesis-safe).
 *
 * Seluruhnya murni: tanpa RPC, tanpa LevelDB, tanpa side effect —
 * aman dijalankan kapan pun tanpa node hidup.
 */
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { signTransaction } from 'src/crypto/signTransaction'
import { recoverPublicKey } from 'src/crypto/recoverPublicKey'
import { verifySignature } from 'src/crypto/verifySignature'
import { txSighash } from 'src/core/encoding/rlp/txCodec'
import { TxInterface } from 'src/types/transaction'
import { Block } from 'src/core/block/blockModel'
import { buildGenesisBlock } from 'src/core/block/genesis'
import { cutBlockReward } from 'src/core/block/distributeBlockReward'
import { calculateTotalFees } from 'src/core/transaction/utils/totalFees'
import {
	calculateTotalBlockReward,
	GAS_PRICE_NEXU,
} from 'src/core/consensus/calculateReward'
import { verifyBlockReward } from 'src/core/consensus/verify/module/verifyReward'
import {
	checkBlockTimestamp,
	MTP_WINDOW,
	MAX_FUTURE_DRIFT_MS,
} from 'src/core/consensus/verify/module/verifyTimestamp'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { CHAIN_ID } from 'src/crypto/chainId'

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

/** Panggil `fn`, kembalikan Error yang dilempar, atau null bila tidak. */
const caught = (fn: () => unknown): Error | null => {
	try {
		void fn()
		return null
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error))
	}
}

// ---------------------------------------------------------------------------
// 1. Low-S (EIP-2)
// ---------------------------------------------------------------------------

console.log('RULE 1 — low-S signature (EIP-2):')

/** Ordo secp256k1 n dan batas low-S n/2 (harus sama dengan di recoverPublicKey). */
const SECP256K1_ORDER = BigInt(
	'0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
)
const HALF_N = SECP256K1_ORDER >> 1n

// Mnemonic BIP39 tetap -> kunci deterministik (sama dengan check:tx).
const MNEMONIC =
	'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const { privateKey, publicKey } = generateKeysFromMnemonic(MNEMONIC)
// `generateKeysFromMnemonic` mengembalikan "Nx"-prefixed — address dibuat
// dari hex polos (sama seperti check:tx).
const address = generateAddressFromPublicKey(publicKey.slice(2))

const unsignedTx: TxInterface = {
	nonce: 0,
	fee: 5_000,
	receiver: `NxC${'22'.repeat(20)}`,
	amount: 1,
	sign: { v: 0, r: '0'.repeat(64), s: '0'.repeat(64) },
}

// Tanda tangan asli dibuat repo sendiri (canonical: true -> s selalu low-S).
const signedTx = signTransaction(unsignedTx, privateKey)
const sighash = txSighash(unsignedTx)
const originalSign = signedTx.sign!

const lowS = BigInt('0x' + originalSign.s)
ok(
	'hasil signTransaction sendiri memang low-S (s <= n/2)',
	lowS >= 1n && lowS <= HALF_N,
	`s=${lowS}`,
)
ok(
	'verifySignature LOLOS untuk signature normal',
	verifySignature(sighash, originalSign, address) === true,
)
ok(
	'recoverPublicKey tidak melempar untuk signature normal',
	caught(() => recoverPublicKey(sighash, originalSign)) === null,
)

// Malleate: s' = n - s (signature high-S yang tetap valid secara ECDSA).
const highS = SECP256K1_ORDER - lowS
const highSign = { ...originalSign, s: highS.toString(16).padStart(64, '0') }
ok(
	"kombinasi malleated memang high-S (s' > n/2)",
	highS > HALF_N,
	`s'=${highS}`,
)

const highError = caught(() => recoverPublicKey(sighash, highSign))
ok(
	'recoverPublicKey MELEMPAR untuk high-S',
	highError !== null,
	'(tidak melempar)',
)
ok(
	'pesan error menyebut low-S / EIP-2',
	highError !== null && /low-S|EIP-2/i.test(highError.message),
	highError?.message ?? '(tidak melempar)',
)
ok(
	'verifySignature MENGEMBALIKAN false untuk high-S',
	verifySignature(sighash, highSign, address) === false,
)
ok(
	'verifySignature tanpa expectedAddress juga false untuk high-S',
	verifySignature(sighash, highSign) === false,
)

// Batas rentang skalar: s = 0 dan s = n juga harus ditolak.
const zeroSign = { ...originalSign, s: '0'.repeat(64) }
ok(
	'recoverPublicKey MELEMPAR untuk s = 0',
	caught(() => recoverPublicKey(sighash, zeroSign)) !== null,
)
const orderSign = {
	...originalSign,
	s: SECP256K1_ORDER.toString(16).padStart(64, '0'),
}
ok(
	'recoverPublicKey MELEMPAR untuk s = n',
	caught(() => recoverPublicKey(sighash, orderSign)) !== null,
)

// ---------------------------------------------------------------------------
// 2. Hadiah & fee blok
// ---------------------------------------------------------------------------

console.log('RULE 2 — verifikasi hadiah/fee blok:')

const MINER = `NxC${'ab'.repeat(20)}`
const HEIGHT = 123
const FEE = 5_000

/**
 * Fixture blok height 123 yang SELURUH angkanya dihitung dengan fungsi yang
 * SAMA seperti template — sengaja bukan salinan literal angka, supaya gate
 * ini tetap benar bila jadwal hadiah berubah (perubahan itu sendiri harus
 * lewat review P2 terpisah).
 */
const makeRewardBlock = (): Block =>
	new Block({
		header: {
			previousBlockHash: `${'ab'.repeat(32)}`,
			timestamp: 1_760_000_000_000,
			hash: `${'cd'.repeat(32)}`,
			nonce: 42,
			version: '1.0.0',
			difficulty: 20,
			hashingAlgorithm: 'SHA256',
		},
		height: HEIGHT,
		size: 1,
		totalTransactionFees: calculateTotalFees([
			{
				nonce: 0,
				fee: FEE,
				receiver: MINER,
				amount: 1,
				sign: { v: 0, r: 'a'.repeat(64), s: 'b'.repeat(64) },
			},
		]),
		merkleRoot: `${'ef'.repeat(32)}`,
		minerId: MINER,
		chainId: CHAIN_ID,
		status: 'confirmed',
		blockReward: cutBlockReward(HEIGHT),
		totalReward: calculateTotalBlockReward(
			cutBlockReward(HEIGHT),
			GAS_PRICE_NEXU,
			FEE,
		),
		coinbaseTransaction: {
			amount: calculateTotalBlockReward(
				cutBlockReward(HEIGHT),
				GAS_PRICE_NEXU,
				FEE,
			),
			receiver: MINER,
			extraData: stringToHex('Block reward'),
		},
		metadata: {
			txCount: 1,
			gasPrice: GAS_PRICE_NEXU,
			created_at: 1_760_000_000_000,
			extraData: stringToHex('fixture'),
		},
		transactions: [
			{
				nonce: 0,
				fee: FEE,
				receiver: MINER,
				amount: 1,
				sign: { v: 0, r: 'a'.repeat(64), s: 'b'.repeat(64) },
			},
		],
	})

/** Tes bahwa mutasi tertentu pada blok valid DITOLAK `verifyBlockReward`. */
const expectRewardReject = (
	label: string,
	mutate: (block: Block) => void,
): void => {
	const block = makeRewardBlock()
	mutate(block)
	const reason = verifyBlockReward(block)
	ok(`${label} DITOLAK`, reason !== null, reason ?? '(lolos)')
}

ok(
	'fixture height 123 diterima (nilai dihitung ulang, bukan literal)',
	verifyBlockReward(makeRewardBlock()) === null,
)
ok(
	'genesis (height 0) exempt — buildGenesisBlock() diterima',
	verifyBlockReward(buildGenesisBlock()) === null,
)

expectRewardReject('totalReward +1', (b) => {
	b.block.totalReward += 1
})
expectRewardReject('blockReward +1', (b) => {
	b.block.blockReward += 1
})
expectRewardReject('coinbase.amount +1', (b) => {
	b.block.coinbaseTransaction.amount += 1
})
expectRewardReject('coinbase.receiver != minerId', (b) => {
	b.block.coinbaseTransaction.receiver = `NxC${'cd'.repeat(20)}`
})
expectRewardReject('totalTransactionFees off-by-one', (b) => {
	b.block.totalTransactionFees += 1
})
expectRewardReject('metadata.gasPrice off-by-one', (b) => {
	b.block.metadata!.gasPrice += 1
})
expectRewardReject('metadata hilang pada height > 0', (b) => {
	delete b.block.metadata
})

// ---------------------------------------------------------------------------
// 3. Timestamp MTP-11 + batas masa depan
// ---------------------------------------------------------------------------

console.log('RULE 3 — timestamp MTP-11 + batas masa depan:')

/** Anchor waktu tetap — tes tidak bergantung pada Date.now(). */
const NOW = 1_800_000_000_000

// 15 timestamp naik, jarak 1 detik — hanya 11 TERAKHIR yang masuk jendela.
const fifteenPrev = Array.from(
	{ length: 15 },
	(_unused, index) => NOW - (15 - index) * 1_000,
)
// Jendela 11 terakhir: NOW-11.000 … NOW-1.000 → index floor(11/2)=5 → NOW-6.000.
const mtp11 = NOW - 6_000
ok('MTP_WINDOW === 11', MTP_WINDOW === 11, `got=${MTP_WINDOW}`)
ok(
	'batas masa depan === 2 jam',
	MAX_FUTURE_DRIFT_MS === 2 * 60 * 60 * 1000,
	`got=${MAX_FUTURE_DRIFT_MS}`,
)
ok(
	`ts == mtp (${mtp11}) DITOLAK (harus > mtp)`,
	checkBlockTimestamp(mtp11, fifteenPrev, NOW) !== null,
	checkBlockTimestamp(mtp11, fifteenPrev, NOW) ?? '(lolos)',
)
ok(
	`ts == mtp+1 (${mtp11 + 1}) diterima`,
	checkBlockTimestamp(mtp11 + 1, fifteenPrev, NOW) === null,
	checkBlockTimestamp(mtp11 + 1, fifteenPrev, NOW) ?? '(seharusnya null)',
)

// Daftar kosong: hanya cek masa depan yang berjalan (genesis-safe).
ok(
	'ts == now + 2h diterima (daftar kosong)',
	checkBlockTimestamp(NOW + MAX_FUTURE_DRIFT_MS, [], NOW) === null,
)
ok(
	'ts == now + 2h + 1 DITOLAK',
	checkBlockTimestamp(NOW + MAX_FUTURE_DRIFT_MS + 1, [], NOW) !== null,
	checkBlockTimestamp(NOW + MAX_FUTURE_DRIFT_MS + 1, [], NOW) ?? '(lolos)',
)
ok(
	'daftar kosong + ts lampau diterima (hanya cek masa depan)',
	checkBlockTimestamp(NOW - 10_000, [], NOW) === null,
)

// MTP pakai jendela 11 terakhir saja — 4 timestamp paling awal diabaikan.
const earlyMedian = (() => {
	const all = [...fifteenPrev].sort((a, b) => a - b)
	return all[Math.floor(all.length / 2)]
})()
ok(
	'median dihitung dari 11 terakhir, bukan seluruh daftar',
	earlyMedian !== mtp11,
	`full=${earlyMedian} window=${mtp11}`,
)

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
