/**
 * wallet-new core gate: offline, no LevelDB and no node.
 * Proves the data contract before the extension shell is built.
 * Run: bun run check (from wallet-new/) or bun wallet-new/scripts/coreCheck.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	ACTIVITY_PAGE_SIZE,
	CHAIN_ID,
	KDF_ITERATIONS,
	SIGNED_ITEM_COUNT,
	TX_TYPE,
	UNSIGNED_ITEM_COUNT,
	authCheck,
	buildSignedTransaction,
	bumpFee,
	createJsCrypto,
	createMemoryKV,
	createWalletVault,
	decodeTx,
	decryptSecret,
	encryptSecret,
	encodeTx,
	encodeTxPayload,
	fetchAccount,
	fetchActivityPage,
	fetchBalanceString,
	fetchNextNonce,
	fetchPendingReserve,
	formatNxc,
	genRandomMnemonic,
	generateAddressFromPublicKey,
	generateKeysFromMnemonic,
	isNexu,
	isTxHash,
	isValidAddress,
	sendRawTransaction,
	setRpcCredentials,
	toNexu,
	validateMnemonic,
	validateSendForm,
	type BuildResult,
	type TxInterface,
	type VaultCrypto,
} from '../src/index'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${label}`)
	} else {
		fail++
		console.log(`  FAIL ${label}${extra ? `  -> ${extra}` : ''}`)
	}
}

const rejected = async (fn: () => Promise<unknown>): Promise<boolean> => {
	try {
		await fn()
		return false
	} catch {
		return true
	}
}

const fastCrypto: VaultCrypto = {
	genMnemonic: genRandomMnemonic,
	validateMnemonic,
	deriveKeys: (mnemonic) => {
		const { privateKey, publicKey } = generateKeysFromMnemonic(mnemonic)
		return {
			address: generateAddressFromPublicKey(publicKey),
			publicKey,
			privateKey,
			mnemonic,
		}
	},
	// Production iterations are still tested via KDF_ITERATIONS; this only speeds up the gate.
	encryptSecret: (secret, passphrase) =>
		encryptSecret(secret, passphrase, 1_000),
	decryptSecret: (blob, passphrase) => decryptSecret(blob, passphrase),
}

// ---------- 1. Vault and crypto ----------
console.log('\n--- vault ---')
const kv = createMemoryKV()
const vault = createWalletVault(kv, { crypto: fastCrypto })
ok('vault: starts empty', !(await vault.hasWallet()))

const phrase = genRandomMnemonic()
const info = await vault.importMnemonic(phrase, 'test-secret')
ok('vault: NxC address plus 40 hex', /^NxC[0-9a-f]{40}$/.test(info.address))
const derived = generateKeysFromMnemonic(phrase)
ok(
	'vault: private key matches direct derivation',
	vault.getUnlocked().privateKey === derived.privateKey,
)
ok(
	'vault: production KDF is within the contract range',
	KDF_ITERATIONS >= 100_000 && KDF_ITERATIONS <= 10_000_000,
)

const record = await kv.get('primary')
const dump = JSON.stringify(record)
ok('vault: record does not contain the mnemonic', !dump.includes(phrase))
ok(
	'vault: record does not contain the private key',
	!dump.includes(derived.privateKey),
)

vault.lock()
ok('vault: lock clears the keys', !vault.isUnlocked())
ok(
	'vault: getInfo still reads while locked',
	(await vault.getInfo())?.address === info.address,
)
ok(
	'vault: wrong passphrase is rejected',
	await rejected(() => vault.unlock('wrong')),
)
await vault.unlock('test-secret')
ok(
	'vault: unlock restores the same private key',
	vault.getUnlocked().privateKey === derived.privateKey,
)

const jsBlob = await encryptSecret(
	phrase,
	'cross-origin',
	1_000,
	createJsCrypto(),
)
ok(
	'vault: JS fallback blob opens with Web Crypto',
	(await decryptSecret(jsBlob, 'cross-origin')) === phrase,
)
await vault.wipe()
ok('vault: wipe removes the record', !(await vault.hasWallet()))

// ---------- 2. Units and identity ----------
console.log('\n--- units and identity ---')
ok('units: toNexu(0.00025) = 25000', toNexu('0.00025') === 25_000)
ok('units: formatNxc(25000) = 0.00025', formatNxc(25_000) === '0.00025')
ok('units: 5e15 nexu ceiling is guarded', isNexu(5e15) && !isNexu(5e15 + 1))
ok(
	'address: NxC is 43 chars',
	isValidAddress(info.address) && !isValidAddress('NxCabc'),
)
ok(
	'address: lowercase hex only',
	!isValidAddress(`NxC${'A'.repeat(40)}`) &&
		!isValidAddress(`NxC${'g'.repeat(40)}`),
)
ok(
	'txHash: TxC plus 64 hex (not bare 64)',
	isTxHash(`TxC${'a'.repeat(64)}`) && !isTxHash('a'.repeat(64)),
)
ok('chainId defaults to 2010', CHAIN_ID === 2010)

// ---------- 3 and 4. Wire tx, automatic fee, RBF ----------
console.log('\n--- transactions ---')
const sender = info.address
const receiver = `NxC${'0'.repeat(39)}1`
const form = { receiver, amountNxc: '1.5' }
const built: BuildResult = await buildSignedTransaction(
	form,
	sender,
	derived.privateKey,
	0,
)
ok('tx: builds successfully', built.ok && built.tx !== undefined, built.error)
const tx = built.tx
if (!tx || built.fee === undefined)
	throw new Error('tx build failed; the gate cannot continue')

const encoded = encodeTx(tx)
ok('tx: RPC param is base64', /^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
const decoded = decodeTx(encoded)
ok('tx: from is recomputed from the signature', decoded.from === tx.from)
ok(
	'tx: txHash is recomputed from the payload',
	decoded.txHash === tx.txHash && isTxHash(decoded.txHash ?? ''),
)
ok(
	'tx: EIP-155 v for chainId 2010',
	tx.sign.v === 4055 || tx.sign.v === 4056,
)
ok(
	'tx: 6 unsigned items / 8 signed items / type 0x02',
	UNSIGNED_ITEM_COUNT === 6 && SIGNED_ITEM_COUNT === 8 && TX_TYPE === 0x02,
)
ok(
	'tx: derived fields are not on the wire',
	encodeTx({ ...tx, from: 'Fake', txHash: 'Fake' }) === encoded,
)
ok(
	'fee: fixed point fee === wire size',
	built.fee === encodeTxPayload(tx).length,
)
ok('fee: BuildResult.fee === tx.fee', built.fee === tx.fee)

const rebuilt = await buildSignedTransaction(
	form,
	sender,
	derived.privateKey,
	0,
)
ok(
	'preview: wire is identical when rebuilt',
	encodeTx(rebuilt.tx!) === encoded && rebuilt.fee === built.fee,
)

ok(
	'validation: amount 0 is rejected',
	validateSendForm({ ...form, amountNxc: '0' }, sender).amount !== undefined,
)
ok(
	'validation: sub-nexu is rejected',
	validateSendForm({ ...form, amountNxc: '0.000000001' }, sender).amount !==
		undefined,
)
ok(
	'validation: sender equals recipient is rejected',
	validateSendForm({ ...form, receiver: sender }, sender).receiver !==
		undefined,
)
ok(
	'validation: uppercase hex receiver is normalized',
	validateSendForm(
		{ ...form, receiver: `NxC${'0'.repeat(39)}A` },
		sender,
	).receiver === undefined,
)
ok(
	'validation: thousands separator is rejected',
	validateSendForm({ ...form, amountNxc: '10.000' }, sender).amount !==
		undefined,
)

const withMessage = await buildSignedTransaction(
	{ ...form, message: 'hello' },
	sender,
	derived.privateKey,
	0,
)
ok(
	'fee: a message raises the fee and stays fixed point',
	withMessage.ok &&
		withMessage.fee === encodeTxPayload(withMessage.tx!).length &&
		withMessage.fee! > built.fee!,
)

const bumped = await bumpFee(tx, sender, derived.privateKey)
ok(
	'RBF: same nonce, 2x fee',
	bumped.ok && bumped.tx!.nonce === tx.nonce && bumped.fee === built.fee! * 2,
)
const oldSize = encodeTxPayload(tx).length
const newSize = encodeTxPayload(bumped.tx!).length
ok(
	'RBF: fee rate is higher (cross multiplication)',
	bumped.fee! * oldSize > built.fee! * newSize,
)
ok(
	'RBF: another user tx is rejected',
	!(await bumpFee(tx, receiver, derived.privateKey)).ok,
)

// ---------- 5. RPC (stubbed fetch) ----------
console.log('\n--- RPC ---')
type Call = { method: string; params: unknown; authorization?: string }
const calls: Call[] = []
const routes: Record<string, unknown> = {
	nex_getAccount: {
		address: sender,
		balance: 1_000_000,
		transactionCount: 1,
		lastTransactionDate: null,
		nonce: 0,
	},
	nex_getBalance: '12.5 NXC',
	nex_getNextNonce: 7,
	nex_getPendingReserve: { address: sender, pendingAmount: 100 },
	nex_getTransactionsByAddress: {
		count: 4,
		history: [
			{ txHash: `TxC${'c'.repeat(64)}`, amount: 2 },
			{ txHash: `TxC${'a'.repeat(64)}`, amount: 1 },
		],
		page: 1,
		pageSize: ACTIVITY_PAGE_SIZE,
		totalPages: 2,
	},
	// One duplicate of confirmed (`c...`) and one real pending (`e...`).
	nex_getPendingByAddress: [
		{ txHash: `TxC${'c'.repeat(64)}`, amount: 9 },
		{ txHash: `TxC${'e'.repeat(64)}`, amount: 3 },
	],
	nex_sendRawTransaction: { status: true, txHash: `TxC${'b'.repeat(64)}` },
	nex_authCheck: { status: true },
}
const historyPages: Record<number, unknown> = {
	1: routes.nex_getTransactionsByAddress,
	2: {
		count: 4,
		history: [{ txHash: `TxC${'d'.repeat(64)}`, amount: 4 }],
		page: 2,
		pageSize: ACTIVITY_PAGE_SIZE,
		totalPages: 2,
	},
}
let statusOverride = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const body = JSON.parse(String(init?.body)) as {
		method: string
		params: unknown
		id: unknown
	}
	const headers = init?.headers as Record<string, string> | undefined
	calls.push({
		method: body.method,
		params: body.params,
		authorization: headers?.authorization,
	})
	if (statusOverride > 0) {
		return new Response('', { status: statusOverride })
	}
	const query = body.params as { page?: number } | undefined
	const result =
		body.method === 'nex_getTransactionsByAddress'
			? historyPages[query?.page ?? 1]
			: routes[body.method]
	return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	})
}) as typeof fetch

try {
	ok(
		'rpc: nonce uses nex_getNextNonce',
		(await fetchNextNonce(sender)) === 7 &&
			calls.at(-1)?.method === 'nex_getNextNonce',
	)
	ok(
		'rpc: balance stays a string',
		(await fetchBalanceString(sender)) === '12.5 NXC',
	)
	ok(
		'rpc: account is readable',
		(await fetchAccount(sender))?.address === sender,
	)
	ok(
		'rpc: pending reserve is readable',
		(await fetchPendingReserve(sender))?.pendingAmount === 100,
	)

	const page = await fetchActivityPage(sender)
	ok(
		'rpc: pending is above confirmed',
		page.rows[0]?.pending === true && page.rows[1]?.pending === false,
	)
	ok(
		'rpc: node order is not re-sorted',
		page.rows[1]?.tx.amount === 2 && page.rows[2]?.tx.amount === 1,
	)
	ok(
		'rpc: dedup by txHash',
		page.rows.length === 3 &&
			page.rows.filter((row) => row.pending).length === 1 &&
			page.total === 4,
	)
	const historyCall = calls.find(
		(call) => call.method === 'nex_getTransactionsByAddress',
	)?.params as { address: string; page: number; pageSize: number }
	ok(
		'rpc: history uses paginated params',
		historyCall?.address === sender &&
			historyCall?.page === 1 &&
			historyCall?.pageSize === ACTIVITY_PAGE_SIZE,
	)
	const second = await fetchActivityPage(sender, 2)
	const historyCalls = calls.filter(
		(call) => call.method === 'nex_getTransactionsByAddress',
	)
	const pendingCalls = calls.filter(
		(call) => call.method === 'nex_getPendingByAddress',
	)
	ok(
		'rpc: page 2 is confirmed-only',
		second.page === 2 &&
			second.rows.length === 1 &&
			second.rows.every((row) => !row.pending),
	)
	ok(
		'rpc: page 2 does not fetch pending again',
		pendingCalls.length === 1 &&
			(historyCalls.at(-1)?.params as { page?: number })?.page === 2,
	)
	ok(
		'rpc: page 2 keeps total and totalPages',
		second.total === 4 && second.totalPages === 2,
	)

	setRpcCredentials('user', 'secret')
	const sent = await sendRawTransaction(tx)
	ok(
		'rpc: send succeeds with the node txHash',
		sent.status && sent.txHash === `TxC${'b'.repeat(64)}`,
	)
	const writeCall = calls.at(-1)!
	ok(
		'rpc: write method uses base64',
		writeCall.method === 'nex_sendRawTransaction' &&
			writeCall.params === encoded,
	)
	ok(
		'rpc: write method includes Basic Auth',
		writeCall.authorization?.startsWith('Basic ') === true,
	)
	ok(
		'rpc: authCheck uses the write path',
		(await authCheck()).status === true &&
			calls.at(-1)?.method === 'nex_authCheck',
	)

	statusOverride = 401
	ok(
		'rpc: HTTP 401 maps to a credential message',
		await rejected(() => sendRawTransaction(tx)),
	)
	statusOverride = 0
	setRpcCredentials('', '')
	ok(
		'rpc: no credentials means no auth header',
		(await authCheck()).status === true &&
			calls.at(-1)?.authorization === undefined,
	)
} finally {
	globalThis.fetch = originalFetch
}

// ---------- 6. Source guards ----------
console.log('\n--- source guards ---')
const srcDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src')
const source = (readdirSync(srcDir, { recursive: true }) as string[])
	.filter((rel) => rel.endsWith('.ts'))
	.map((rel) => readFileSync(join(srcDir, rel), 'utf8'))
	.join('\n')
ok('guard: no Number() in amount conversion', !/\bNumber\s*\(/.test(source))
ok(
	'guard: no default import of bip39',
	!/import\s+\w+\s+from\s+['"]bip39['"]/.test(source),
)
ok(
	'guard: no node: builtins in browser modules',
	!/from\s+['"]node:/.test(source),
)
ok(
	'guard: no local crypto implementation',
	!/\bcreateHash\b|\bsecp256k1\b/.test(source),
)

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
