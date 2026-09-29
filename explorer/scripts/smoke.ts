/**
 * Smoke test E2E — menjalankan KODE CLIENT explorer yang asli
 * (rpcClient + methods + decoder + isNotFound) terhadap RPC server live.
 *
 * Jalankan dari folder explorer/:
 *     bun run smoke
 * (butuh server RPC hidup: bun run rpc:start)
 *
 * Selain jalur happy-path, test ini mengunci signature "tidak ditemukan"
 * khas backend (Bun + Level) yang diverifikasi lewat probe:
 *   - height miss  → `result: null`           → wajib jadi `undefined`
 *   - hash miss    → error "Expected String"  → wajib lolos isNotFound
 *   - tx miss         → error "buffer.toString" → wajib lolos isNotFound
 * Kalau backend berubah perilaku, test ini biru/merah lebih dulu
 * sebelum UI menampilkan "Something went wrong" yang menyesatkan.
 */
import { rpc } from '../src/api/methods'
import { isNotFound } from '../src/api/rpcClient'

let pass = 0
let fail = 0

const check = (name: string, cond: boolean, extra = '') => {
	if (cond) {
		pass += 1
		console.log(`  ok  ${name}${extra ? ` — ${extra}` : ''}`)
	} else {
		fail += 1
		console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`)
	}
}
const describe = (e: unknown): string =>
	e instanceof Error
		? `${(e as { kind?: string }).kind ?? '?'}: ${e.message}`
		: String(e)

// 1) block state: hex JSON → object
const state = await rpc.getBlockState()
check(
	'getBlockState → object terdecode',
	typeof state?.currentBlockHeight === 'number' &&
		typeof state.blockReward === 'number',
	`height=${state?.currentBlockHeight} reward=${state?.blockReward}`,
)

// 2) chainId tanpa params
const cid = await rpc.getChainId()
check('getChainId → 26', cid === 26, `got=${cid}`)

// 3) recentBlocks scalar
const recent = await rpc.getRecentBlocks(5)
check(
	'recentBlocks(5) → 5 summary',
	Array.isArray(recent) && recent.length === 5,
	`len=${recent?.length}`,
)

// 4) blocksRange objek {from,count}
const tip = state.currentBlockHeight
const range = await rpc.getBlocksRange(tip, 3)
check(
	'blocksRange({from,count}) → 3',
	Array.isArray(range) && range.length === 3 && range[0].height === tip,
	`first=${range?.[0]?.height}`,
)

// 5) block HIT by height
const block = await rpc.getBlockByHeight(tip)
check(
	'blockByHeight hit → header.hash',
	typeof block?.block?.header?.hash === 'string',
	`hash=${block?.block?.header?.hash?.slice(0, 16)}…`,
)

// 6) block MISS by height → undefined (server balas result:null)
const missByHeight = await rpc.getBlockByHeight(999999999)
check(
	'blockByHeight miss → undefined (bukan null)',
	missByHeight === undefined,
	`got=${typeof missByHeight}`,
)

// 7) block MISS by hash → error "Expected String" → isNotFound
try {
	const m = await rpc.getBlockByHash('f'.repeat(64))
	check('blockByHash miss → undefined', m === undefined, `got=${typeof m}`)
} catch (e) {
	check('blockByHash miss → isNotFound', isNotFound(e), describe(e))
}

// 8) block HIT by hash → height sama dengan tip
const realHash = block?.block?.header?.hash
if (realHash) {
	try {
		const byHash = await rpc.getBlockByHash(realHash)
		check(
			'blockByHash hit → height sama',
			byHash?.block?.height === tip,
			`height=${byHash?.block?.height}`,
		)
	} catch (e) {
		check('blockByHash hit', false, describe(e))
	}
} else {
	check('blockByHash hit (hash tersedia)', false, 'tip block tidak terdecode')
}

// 9) tx MISS → error "buffer.toString" → isNotFound
try {
	const t = await rpc.getTransactionByHash(`0x${'f'.repeat(64)}`)
	check('txByHash miss → undefined', t === undefined, `got=${typeof t}`)
} catch (e) {
	check('txByHash miss → isNotFound', isNotFound(e), describe(e))
}

// 10) account unknown valid-format → object default (bukan error)
const acct = await rpc.getAccount(`NxC${'1'.repeat(40)}`)
check(
	'getAccount unknown → default {balance:0}',
	acct?.balance === 0 && acct.isContract === false,
	`nonce=${acct?.nonce} lastTx=${acct?.lastTransactionDate}`,
)

// 11) history unknown → {count:0, history:[]}
const hist = await rpc.getTransactionsByAddress(`NxC${'1'.repeat(40)}`)
check(
	'history unknown → {0,[]}',
	hist.count === 0 && hist.history.length === 0,
	`count=${hist.count} len=${hist.history.length}`,
)

// 12) mempool tanpa params
const pool = await rpc.getMempool()
check('getMempool → array', Array.isArray(pool), `len=${pool.length}`)

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
