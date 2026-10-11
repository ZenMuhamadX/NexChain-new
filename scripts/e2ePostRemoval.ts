/**
 * E2E pasca-penghapusan smart contract + perbaikan race (1-6).
 *
 * Semua lewat RPC ke node HIDUP — skrip ini TIDAK membuka LevelDB (aman
 * berdampingan dengan proses node).
 *
 * Skenario:
 *   0. drain mempool sisa (bila ada) supaya baseline bersih
 *   1. `nex_getContractBalance` sudah TIDAK ADA (method not found)
 *   2. `nex_getWork` lolos  → verifikasi penuh rantai LAMA dengan skema baru
 *   3. TX-A: fee ter-debit penuh (amount+fee), reserve pending tepat, R4
 *   4. TX-B: format lama ber-flag kontrak tetap diterima (kompat klien lama)
 *   5. 10 tx PARALEL (balapan nonce) → reserve = jumlah yang benar-benar
 *      lolos × (amount+fee), nonce yang lolos unik (admissionQueue / R3)
 *   6. mine 1 blok via miner eksternal → semua tx dieksekusi TEPAT SEKALI,
 *      pending → 0, coinbase lewat processTransact, saldo akun:
 *      bal0 − (semua amount+fee) + totalReward  (fee tidak dicetak / R4)
 *   7. `nex_getWork` setelah blok baru → rantai baru+lama tetap lolos
 *
 * Jalankan (node harus hidup):  bun run scripts/e2ePostRemoval.ts
 */
import { execSync, spawn } from 'node:child_process'
import { loadWallet } from 'src/wallet/utils/loadWallet'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { client } from 'src/client/rpc-client/lib/rpcClient'
import { decodeHexJson } from 'src/client/rpc-client/lib/decodeHexJson'
import type { TxInterface } from 'src/types/transaction'

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

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

const rpcCall = <T>(method: string, params?: unknown): Promise<T> =>
	client.request(method, params as never) as Promise<T>

const hexJson = async <T>(
	method: string,
	params?: unknown,
): Promise<T | undefined> =>
	decodeHexJson<T>(await rpcCall<unknown>(method, params))

interface BlockStateLite {
	currentBlockHeight?: number
}
interface AccountLite {
	balance?: number
	nonce?: number
}
interface PendingLite {
	pendingAmount?: number
}

const heightOf = async (): Promise<number> =>
	(await hexJson<BlockStateLite>('nex_getBlockState'))?.currentBlockHeight ?? -1

const getBal = async (address: string): Promise<number> =>
	(await hexJson<AccountLite>('nex_getAccount', address))?.balance ?? 0

const pendingOf = async (address: string): Promise<number> =>
	(await hexJson<PendingLite>('nex_getPendingBalance', address))
		?.pendingAmount ?? 0

const nextNonce = async (address: string): Promise<number> =>
	(await hexJson<number>('nex_getNextNonce', address)) ?? 0

// ---------------------------------------------------------------------------
// wallet node + helper transaksi
// ---------------------------------------------------------------------------

const wallet = loadWallet()
if (!wallet) {
	console.error('Wallet node tidak ditemukan — batal.')
	process.exit(1)
}
const sender: string = wallet.address
const { privateKey } = generateKeysFromMnemonic(wallet.phrase)

const freshAddress = async (): Promise<string> => {
	const phrase = await genRandomMnemonic()
	const { publicKey } = generateKeysFromMnemonic(phrase)
	return generateAddressFromPublicKey(publicKey.slice(2))
}

interface SendResult {
	ok: boolean
	nonce?: number | undefined
	txHash?: string | undefined
	error?: string | undefined
}

const sendTx = async (
	receiver: string,
	amount: number,
	fee: number,
	legacyFlags = false,
): Promise<SendResult> => {
	const nonce = await nextNonce(sender)
	const built = createUnsignedTransaction(
		{
			format: 'nexu',
			sender,
			receiver,
			amount,
			fee,
		},
		nonce,
	)
	if (!built.status || !built.tx) {
		return { ok: false, nonce, error: built.error ?? 'build gagal' }
	}
	let tx: TxInterface = signTransaction(built.tx, privateKey)
	if (legacyFlags) {
		// Klien LAMA masih menyertakan flag kontrak — field ini tidak ikut
		// di-hash, dan kini bersifat opsional: harus tetap diterima mempool.
		tx = {
			...tx,
			isSenderContract: true,
			isReceiverContract: true,
		} as TxInterface
	}
	try {
		const accepted = await rpcCall<boolean>('nex_sendTransaction', encodeTx(tx))
		return { ok: accepted === true, nonce, txHash: tx.txHash }
	} catch (error) {
		return {
			ok: false,
			nonce,
			txHash: tx.txHash,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

// ---------------------------------------------------------------------------
// miner proses anak (spawn → stop setelah blok naik)
// ---------------------------------------------------------------------------

let minerLog = ''
const startMiner = () => {
	// `mine.ts` sudah tidak ada sejak commit a377d8a (terhapus bersamaan
	// dengan pembuatan mineCLI.ts yang interaktif). Entry non-interaktif
	// yang sama perannya ada di scripts/mineChild.ts.
	const proc = spawn('bun', ['scripts/mineChild.ts', sender], {
		cwd: process.cwd(),
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	proc.stdout?.on('data', (d) => {
		minerLog += String(d)
	})
	proc.stderr?.on('data', (d) => {
		minerLog += String(d)
	})
	return proc
}

const stopMiner = (proc: ReturnType<typeof spawn>): void => {
	try {
		execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' })
	} catch {
		try {
			proc.kill()
		} catch {
			/* sudah mati */
		}
	}
}

/**
 * Mine sampai height naik 1, memakai 4 miner PARALEL (~4× hashrate).
 *
 * Difficulty mengikuti blok terakhir: setelah test sebelumnya memblokir
 * 6-7 detik (cepat), difficulty bisa naik ke ~25 bit → butuh puluhan juta
 * hash (belasan menit untuk 1 proses). Dengan 4 proses + timeout 10 menit
 * ini aman; blok berikutnya otomatis turun (-4) karena blok jadi lambat.
 * @returns height baru, atau null bila timeout.
 */
const MINER_PROCS = 4
const mineOneBlock = async (): Promise<number | null> => {
	const before = await heightOf()
	const procs = Array.from({ length: MINER_PROCS }, () => startMiner())
	try {
		const deadline = Date.now() + 600_000
		while (Date.now() < deadline) {
			await delay(1500)
			if (procs.every((child) => child.exitCode !== null)) break
			const height = await heightOf().catch(() => -1)
			if (height > before) return height
		}
		return null
	} finally {
		for (const child of procs) stopMiner(child)
		await delay(700)
	}
}

// ---------------------------------------------------------------------------
// skenario
// ---------------------------------------------------------------------------

console.log(`E2E pasca-penghapusan kontrak — sender ${sender}\n`)

// ---- 0. drain sisa mempool (baseline bersih) ----
const pre = await hexJson<unknown[]>('nex_getMempool')
const preCount = Array.isArray(pre) ? pre.length : 0
if (preCount > 0) {
	console.log(
		`  (mempool punya ${preCount} sisa — di-drain dulu dengan 1 blok)`,
	)
	const drained = await mineOneBlock()
	ok(
		'drain blok sisa mempool',
		drained !== null,
		drained ? `height=${drained}` : 'timeout',
	)
}
const pre2 = await hexJson<unknown[]>('nex_getMempool')
const mem0 = Array.isArray(pre2) ? pre2.length : 0
ok('baseline mempool kosong', mem0 === 0, `sisa=${mem0}`)

// ---- 1. RPC kontrak dihapus ----
try {
	await rpcCall('nex_getContractBalance', `NxS${'11'.repeat(20)}`)
	ok('nex_getContractBalance sudah dihapus', false, 'method masih terdaftar!')
} catch (error) {
	const text = JSON.stringify(error ?? '')
	ok(
		'nex_getContractBalance sudah dihapus',
		/-32601|method not found|not found/i.test(text),
		text.slice(0, 140),
	)
}

// ---- 2. getWork → seluruh rantai LAMA diverifikasi dengan skema baru ----
const H0 = await heightOf()
const work = await rpcCall<{
	status?: boolean
	height?: number
	error?: string
}>('nex_getWork', { minerAddress: sender })
ok(
	'getWork lolos — rantai LAMA valid dengan skema baru (verifyStruct opsional)',
	work?.status === true && work.height === H0 + 1,
	work?.error ?? `height=${work?.height} (ekspektasi ${H0 + 1})`,
)

// ---- 3. baseline saldo ----
const bal0 = await getBal(sender)
ok('wallet node punya saldo untuk uji', bal0 > 0, `balance=${bal0} nexu`)

// ---- 4. TX-A: fee ter-debit, reserve tepat (R4) ----
const R1 = await freshAddress()
const A_AMOUNT = 100
const A_FEE = 10
const txA = await sendTx(R1, A_AMOUNT, A_FEE)
ok('TX-A (fee) diterima mempool', txA.ok, txA.error ?? `nonce=${txA.nonce}`)
const pendA = await pendingOf(sender)
ok(
	'reserve pending = amount+fee (fee ikut di-reserve)',
	pendA === A_AMOUNT + A_FEE,
	`pending=${pendA}, ekspektasi=${A_AMOUNT + A_FEE}`,
)
ok(
	'saldo konfirmasi belum berubah (belum dieksekusi)',
	(await getBal(sender)) === bal0,
)
// CATATAN: nex_getAccount mengembalikan objek DEFAULT {balance:0,...} untuk
// alamat yang belum pernah ada — bukan null. Yang dicek: saldo & transaksi 0.
const r1Before = await hexJson<{ balance?: number; transactionCount?: number }>(
	'nex_getAccount',
	R1,
)
ok(
	'receiver masih NOL sebelum blok (belum dieksekusi)',
	(r1Before?.balance ?? 0) === 0 && (r1Before?.transactionCount ?? 0) === 0,
	`balance=${r1Before?.balance}`,
)

// ---- 5. TX-B: format lama ber-flag kontrak → tetap diterima ----
const R2 = await freshAddress()
const B_AMOUNT = 7
const B_FEE = 1
const txB = await sendTx(R2, B_AMOUNT, B_FEE, true)
ok(
	'TX-B (flag kontrak gaya lama) tetap diterima — kompat klien lama',
	txB.ok,
	txB.error ?? '',
)
const pendB = await pendingOf(sender)
ok(
	'reserve bertambah tepat setelah TX-B',
	pendB === A_AMOUNT + A_FEE + B_AMOUNT + B_FEE,
	`pending=${pendB}`,
)

// ---- 6. burst 10 tx PARALEL (balapan nonce) ----
const R3 = await freshAddress()
const C_AMOUNT = 50
const C_FEE = 5
const burst = await Promise.all(
	Array.from({ length: 10 }, () => sendTx(R3, C_AMOUNT, C_FEE)),
)
const accepted = burst.filter((item) => item.ok)
const S = accepted.length
const acceptedNonces = accepted.map((item) => item.nonce!)
const pendC = await pendingOf(sender)
const expectedPend =
	A_AMOUNT + A_FEE + (B_AMOUNT + B_FEE) + S * (C_AMOUNT + C_FEE)
ok('burst paralel: minimal 1 tx lolos', S >= 1, `lolos=${S}/10`)
ok(
	'reserve = Σ(lolos × (amount+fee)) — tanpa kehilangan/overwrite (R3)',
	pendC === expectedPend,
	`pending=${pendC}, ekspektasi=${expectedPend}`,
)
ok(
	'nonce tx yang lolos unik (admissionQueue serial)',
	new Set(acceptedNonces).size === acceptedNonces.length,
	`nonces=[${acceptedNonces.sort((a, b) => a - b).join(',')}]`,
)
const memBefore = await hexJson<unknown[]>('nex_getMempool')
ok(
	'jumlah mempool = tx yang lolos',
	(Array.isArray(memBefore) ? memBefore.length : -1) === 2 + S,
	`mempool=${Array.isArray(memBefore) ? memBefore.length : -1}, ekspektasi=${2 + S}`,
)

// ---- 7. mine 1 blok (miner eksternal, node tetap hidup) ----
const H1 = await mineOneBlock()
ok(
	'blok diproduksi miner eksternal',
	H1 !== null,
	H1 !== null ? `height=${H1}` : `timeout; log: ${minerLog.slice(-400)}`,
)

if (H1 !== null) {
	const ourHashes = [
		txA.txHash!,
		txB.txHash!,
		...accepted.map((item) => item.txHash!),
	]

	const pendAfter = await pendingOf(sender)
	ok('pending → 0 setelah blok', pendAfter === 0, `pending=${pendAfter}`)

	const r1 = await getBal(R1)
	const r2 = await getBal(R2)
	const r3 = await getBal(R3)
	ok(
		'receiver TX-A = amount TEPAT (sekali, tanpa double-credit)',
		r1 === A_AMOUNT,
		`got=${r1}`,
	)
	ok('receiver TX-B = amount TEPAT', r2 === B_AMOUNT, `got=${r2}`)
	ok(
		`receiver burst = ${S}×amount TEPAT (eksekusi tepat sekali)`,
		r3 === S * C_AMOUNT,
		`got=${r3}, ekspektasi=${S * C_AMOUNT}`,
	)

	// blok & coinbase
	const blk = await hexJson<{ block?: Record<string, any> }>(
		'nex_getBlockByHeight',
		H1,
	)
	const block = blk?.block
	const coinbase = block?.transactions?.[0]
	const totalReward: number = block?.totalReward ?? 0
	ok(
		'coinbase tx PERTAMA: sender=COINBASE, receiver=miner, amount=totalReward',
		coinbase?.sender === 'COINBASE' &&
			coinbase?.receiver === sender &&
			coinbase?.amount === totalReward,
		`reward=${totalReward}`,
	)
	const blockHashes: string[] = (block?.transactions ?? [])
		.map((tx: TxInterface) => tx.txHash!)
		.filter((hash: string | undefined): hash is string => !!hash)
	const counts = ourHashes.map(
		(hash) => blockHashes.filter((h) => h === hash).length,
	)
	ok(
		'semua tx uji ada di blok TEPAT SATU KALI',
		counts.every((count) => count === 1),
		`counts=[${counts.join(',')}]`,
	)
	ok(
		`jumlah tx blok = coinbase + ${2 + S} tx uji`,
		block?.transactions?.length === 1 + 2 + S,
		`got=${block?.transactions?.length}, ekspektasi=${1 + 2 + S}`,
	)

	// R4: fee tidak dicetak — pengirim kehilangan amount+fee, penerima hanya amount
	const totalSpent =
		A_AMOUNT + A_FEE + (B_AMOUNT + B_FEE) + S * (C_AMOUNT + C_FEE)
	const balAfter = await getBal(sender)
	ok(
		'saldo sender = bal0 − Σ(amount+fee) + totalReward (fee ter-debit, TIDAK dicetak)',
		balAfter === bal0 - totalSpent + totalReward,
		`got=${balAfter}, ekspektasi=${bal0 - totalSpent + totalReward}`,
	)
}

// ---- 8. getWork setelah blok baru: rantai baru + lama tetap lolos ----
const H2 = await heightOf()
const work2 = await rpcCall<{
	status?: boolean
	height?: number
	error?: string
}>('nex_getWork', { minerAddress: sender })
ok(
	'getWork setelah blok baru — verifikasi penuh tetap lolos',
	work2?.status === true && work2.height === H2 + 1,
	work2?.error ?? `height=${work2?.height} (ekspektasi ${H2 + 1})`,
)

console.log(`\n============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
