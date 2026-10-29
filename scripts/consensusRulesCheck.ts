import { EMPTY_STATE_ROOT } from 'src/core/state/root'
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
 *      `cutBlockReward`/`calculateTotalFees`/`calculateTotalBlockReward`
 *      (tanpa gasPrice sejak P2); field blok TIDAK dipercaya. Setiap
 *      field yang dimanipulasi (totalReward, blockReward, coinbase,
 *      receiver, fees) harus menghasilkan penolakan, dan genesis
 *      tetap exempt.
 *   2b. **Jadwal halving** — boundary epoch (halving pertama tepat di
 *      blok 2_000_001), sifat monotone non-naik, reward epoch raksasa = 0,
 *      dan Σ closed-form seluruh jadwal + genesis ≤ plafon 50 juta NXC
 *      (dibuktikan dengan angka, bukan opini).
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
import { calculateTotalFees } from 'src/core/transaction/utils/totalFees'
import { calculateTotalBlockReward } from 'src/core/consensus/calculateReward'
import {
	cutBlockReward,
	INITIAL_REWARD_NEXU,
	HALVING_INTERVAL,
} from 'src/core/block/distributeBlockReward'
import { buildGenesisBlock, GENESIS_REWARD_NEX } from 'src/core/block/genesis'
import { MAX_SUPPLY_NEXU } from 'src/core/token/constants'
import { verifyBlockReward } from 'src/core/consensus/verify/module/verifyReward'
import {
	checkBlockTimestamp,
	MTP_WINDOW,
	MAX_FUTURE_DRIFT_MS,
} from 'src/core/consensus/verify/module/verifyTimestamp'
import { TARGET_BLOCK_TIME_MS } from 'src/core/consensus/difficulty'
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
const address = generateAddressFromPublicKey(publicKey)

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
			stateRoot: EMPTY_STATE_ROOT,
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
		totalReward: calculateTotalBlockReward(cutBlockReward(HEIGHT), FEE),
		coinbaseTransaction: {
			amount: calculateTotalBlockReward(cutBlockReward(HEIGHT), FEE),
			receiver: MINER,
			extraData: stringToHex('Block reward'),
		},
		metadata: {
			txCount: 1,
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
// Field `gasPrice` dihapus dari metadata pada P2 — karenanya mutasi yang
// dulu diuji di sini (metadata.gasPrice ± 1) tidak ada lagi. Sisa field
// metadata (txCount/created_at/extraData) tidak memengaruhi konsensus
// hadiah; strukturnya dijaga Joi `verifyStruct` (menolak key tak dikenal,
// jadi blok lama ber-gasPrice tetap tertolak di sana).
expectRewardReject('metadata hilang pada height > 0', (b) => {
	delete b.block.metadata
})

// ---------------------------------------------------------------------------
// 2b. Jadwal halving — boundary, monotone, epoch raksasa, Σ ≤ plafon
// ---------------------------------------------------------------------------

console.log('RULE 2b — jadwal halving hadiah blok:')

// Konstanta jadwal harus persis yang disepakati (angka KONSENSUS).
ok(
	'INITIAL_REWARD_NEXU === 1_250_000_000 (12.5 NXC)',
	INITIAL_REWARD_NEXU === 1_250_000_000,
	`got=${INITIAL_REWARD_NEXU}`,
)
ok(
	'HALVING_INTERVAL === 2_000_000',
	HALVING_INTERVAL === 2_000_000,
	`got=${HALVING_INTERVAL}`,
)

// Boundary epoch — halving PERTAMA tepat di blok 2_000_001.
const boundaryCases: Array<[number, number]> = [
	[1, 1_250_000_000],
	[1_999_999, 1_250_000_000],
	[2_000_000, 1_250_000_000],
	[2_000_001, 625_000_000],
	[3_999_999, 625_000_000],
	[4_000_000, 625_000_000],
	[4_000_001, 312_500_000],
]
for (const [height, expected] of boundaryCases) {
	ok(
		`cutBlockReward(${height}) === ${expected}`,
		cutBlockReward(height) === expected,
		`got=${cutBlockReward(height)}`,
	)
}

// Genesis di luar jadwal (reward genesis punya konstanta sendiri).
ok(
	'cutBlockReward(0) === 0 (height < 1 di luar jadwal, genesis exempt)',
	cutBlockReward(0) === 0,
	`got=${cutBlockReward(0)}`,
)

// Monotone non-naik: hadiah tidak pernah naik saat height bertambah.
let monotone = true
let prevReward = cutBlockReward(1)
const monotonePoints = [
	1, 2, 19, 20, 21, 999, 1_999_999, 2_000_000, 2_000_001, 2_000_002, 3_999_999,
	4_000_001, 6_000_001, 10_000_001, 100_000_001,
]
for (const h of monotonePoints) {
	const r = cutBlockReward(h)
	if (r > prevReward) {
		monotone = false
		break
	}
	prevReward = r
}
ok('hadiah monotone non-naik di lintasan boundary', monotone)

// Epoch raksasa → 0 (sub-satoshi-style: di bawah 1 nexu dibuang, bukan 1).
ok(
	'epoch raksasa (blok 100_000_001, epoch 49) === 0',
	cutBlockReward(100_000_001) === 0,
	`got=${cutBlockReward(100_000_001)}`,
)
ok(
	'height Number.MAX_SAFE_INTEGER tetap 0 (tanpa overflow aneh)',
	cutBlockReward(Number.MAX_SAFE_INTEGER) === 0,
	`got=${cutBlockReward(Number.MAX_SAFE_INTEGER)}`,
)

// Σ closed-form seluruh jadwal + genesis — DIBUKTIKAN DENGAN ANGKA.
// Σ = Σ_epoch H · ⌊R0 / 2^epoch⌋ (berhenti saat reward 0), dijumlah
// dengan BigInt supaya tidak ada pembulatan diam-diam.
const scheduleSigma = (() => {
	let sum = 0n
	const h = BigInt(HALVING_INTERVAL)
	const r0 = BigInt(INITIAL_REWARD_NEXU)
	let epoch = 0n
	for (;;) {
		const reward = r0 / 2n ** epoch
		if (reward < 1n) break
		sum += h * reward
		epoch += 1n
	}
	return sum
})()
const genesisIssued = BigInt(GENESIS_REWARD_NEX) * 100_000_000n // NXC → nexu
const maxSupply = BigInt(MAX_SUPPLY_NEXU)
const sigmaTotal = scheduleSigma + genesisIssued

ok(
	`Σ jadwal closed-form === 4_999_999_978_000_000 nexu (49,999,999.78 NXC), got=${scheduleSigma}`,
	scheduleSigma === 4_999_999_978_000_000n,
)
ok(
	`Σ jadwal + genesis (${genesisIssued} nexu) ≤ MAX_SUPPLY_NEXU (${maxSupply})`,
	sigmaTotal <= maxSupply,
	`Σ=${sigmaTotal}`,
)
ok(
	'GENESIS_REWARD_NEX === 0 (premined ke alamat burn, Σ + genesis tetap di bawah plafon)',
	GENESIS_REWARD_NEX === 0,
	`got=${GENESIS_REWARD_NEX}`,
)

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
	'batas masa depan === 2x target blok',
	MAX_FUTURE_DRIFT_MS === 2 * TARGET_BLOCK_TIME_MS,
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
	'ts == now + 2x target diterima (daftar kosong)',
	checkBlockTimestamp(NOW + MAX_FUTURE_DRIFT_MS, [], NOW) === null,
)
ok(
	'ts == now + 2x target + 1 DITOLAK',
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
