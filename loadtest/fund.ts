import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import BIP32Factory from 'bip32'
import { mnemonicToSeedSync } from 'bip39'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { uint8ToHex } from 'src/core/encoding/hex/uint8ToHex'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { formatNxc } from 'src/core/token/formatNxc'
import { parseNxc } from 'src/core/token/parseNxc'
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { ecc } from 'src/crypto/ecc'
import { signTransaction } from 'src/crypto/signTransaction'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DATA_DIR = join(ROOT, 'data', 'loadtest')
const SEED_FILE = join(DATA_DIR, 'seed.txt')
const STATE_FILE = join(DATA_DIR, 'state.json')

// Sumber aturan: src/core/state/storage/mempool/mempoolIndex.ts. Sengaja
// disalin supaya script tidak membuka LevelDB yang sedang dipakai node.
export const PENDING_PER_SENDER = 16
export const SENDERS = 64
export const RECEIVER_START = 1000
export const RECEIVER_COUNT = 1000
export const AMOUNT_NEXU = 1
export const FEE_NEXU = 150

export interface LoadState {
	bank: string
	senders: string[]
	receivers: string[]
	targetTx: number
	childFundNexu: number
	fundedCount: number
	funded: boolean
}

export interface Account {
	address: string
	balance: number
	nonce: number
	transactionCount: number
}

export interface Wallet {
	address: string
	privateKey: string
}

export const numEnv = (name: string, fallback: number): number => {
	const raw = process.env[name]
	if (raw === undefined || raw.trim() === '') return fallback
	const value = Number(raw)
	return Number.isFinite(value) && value >= 0 ? value : fallback
}

export const errMsg = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

export const sleep = (ms: number): Promise<void> =>
	new Promise((done) => setTimeout(done, ms))

const bip32 = BIP32Factory(ecc)

export const deriveWallet = (seed: string): ((index: number) => Wallet) => {
	const master = bip32.fromSeed(mnemonicToSeedSync(seed))
	return (index: number) => {
		const child = master.derivePath(`m/44'/60'/0'/0/${index}`)
		return {
			address: generateAddressFromPublicKey(uint8ToHex(child.publicKey)),
			privateKey: uint8ToHex(child.privateKey!),
		}
	}
}

export const loadSeed = (): string => {
	if (!existsSync(SEED_FILE)) {
		throw new Error('Seed belum ada — jalankan loadtest/fund.ts dulu.')
	}
	return readFileSync(SEED_FILE, 'utf8').trim()
}

export const readState = (): LoadState => {
	if (!existsSync(STATE_FILE)) {
		throw new Error('State belum ada — jalankan loadtest/fund.ts dulu.')
	}
	return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as LoadState
}

export const writeState = (state: LoadState): void => {
	mkdirSync(DATA_DIR, { recursive: true })
	writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
}

const RPC_URL = process.env.NEX_RPC_URL ?? 'http://127.0.0.1:8000/rpc'
let credentials: { user: string; pass: string } | undefined

const rpcHeaders = (): Record<string, string> => {
	const headers: Record<string, string> = { 'content-type': 'application/json' }
	if (credentials !== undefined) {
		headers.authorization =
			'Basic ' +
			Buffer.from(`${credentials.user}:${credentials.pass}`).toString('base64')
	}
	return headers
}

const askLine = async (label: string): Promise<string> => {
	const rl = createInterface({ input: process.stdin, output: process.stdout })
	try {
		return (await rl.question(label)).trim()
	} finally {
		rl.close()
	}
}

const askPassword = async (label: string): Promise<string> => {
	return await new Promise<string>((done) => {
		const input = process.stdin as typeof process.stdin & {
			setRawMode(on: boolean): void
		}
		let value = ''
		const cleanup = () => {
			input.off('data', onData)
			input.setRawMode(false)
			input.pause()
		}
		const onData = (chunk: Buffer) => {
			const text = chunk.toString('utf8')
			if (text === '\r' || text === '\n') {
				cleanup()
				process.stdout.write('\n')
				done(value)
			} else if (text === '\u0003') {
				cleanup()
				process.exit(130)
			} else if (text === '\u007f' || text === '\b') {
				value = value.slice(0, -1)
			} else if (!text.startsWith('\u001b')) {
				value += text
			}
		}
		process.stdout.write(label)
		input.setRawMode(true)
		input.resume()
		input.on('data', onData)
	})
}

const askCredentials = async (): Promise<void> => {
	console.log('Node meminta Basic Auth untuk method tulis.')
	let user: string
	let pass: string
	if (!process.stdin.isTTY) {
		// stdin pipe: baca dua baris sekaligus (readline per-baris bisa menelan
		// baris berikutnya) tanpa menggema kredensial ke layar.
		const raw = await new Promise<string>((resolve) => {
			let text = ''
			process.stdin.on('data', (chunk) => {
				text += chunk.toString('utf8')
			})
			process.stdin.on('end', () => {
				resolve(text)
			})
		})
		const lines = raw.trim().split(/\r?\n/)
		user = lines[0] ?? ''
		pass = lines[1] ?? ''
		process.stdout.write('RPC username: ••••\nRPC password: ••••\n')
	} else {
		user = await askLine('RPC username: ')
		pass = await askPassword('RPC password: ')
	}
	if (user === '' || pass === '') {
		throw new Error('Username/password RPC tidak boleh kosong')
	}
	credentials = { user, pass }
}

interface RpcReply<T> {
	result?: T
	error?: { message?: string }
}

const rawRpc = async <T>(
	method: string,
	params: unknown[],
): Promise<{ status: number; body: RpcReply<T> }> => {
	const response = await fetch(RPC_URL, {
		method: 'POST',
		headers: rpcHeaders(),
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	return {
		status: response.status,
		body: (await response.json()) as RpcReply<T>,
	}
}

export const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
	let reply = await rawRpc<T>(method, params)
	if (reply.status === 401 && credentials === undefined) {
		await askCredentials()
		reply = await rawRpc<T>(method, params)
	}
	if (reply.status === 401) throw new Error(`${method}: kredensial RPC ditolak`)
	if (reply.status === 403) {
		throw new Error(`${method}: akses ditolak (node bukan loopback tanpa kredensial?)`)
	}
	if (reply.body.error !== undefined) {
		throw new Error(`${method}: ${reply.body.error.message ?? 'RPC error'}`)
	}
	if (reply.body.result === undefined) throw new Error(`${method}: hasil kosong`)
	return reply.body.result
}

/** Uji node di awal kedua script, termasuk meminta kredensial bila perlu. */
export const checkNode = async (): Promise<void> => {
	let reply = await rawRpc<{ status: boolean }>('nex_authCheck', [])
	if (reply.status === 401) {
		await askCredentials()
		reply = await rawRpc<{ status: boolean }>('nex_authCheck', [])
	}
	if (reply.status !== 200) {
		throw new Error(`RPC tidak siap: HTTP ${reply.status} di ${RPC_URL}`)
	}
	if (reply.body.error !== undefined || reply.body.result?.status !== true) {
		throw new Error(`nex_authCheck gagal di ${RPC_URL}`)
	}
	await rpc('nex_getRecentBlocks', [1])
	console.log(`Node OK: ${RPC_URL}`)
}

export const getAccount = (address: string): Promise<Account> =>
	rpc<Account>('nex_getAccount', [address])

export const getNextNonce = (address: string): Promise<number> =>
	rpc<number>('nex_getNextNonce', [address])

export const submit = async (
	sender: Wallet,
	nonce: number,
	receiver: string,
	amount: number,
	fee: number,
): Promise<string> => {
	const built = createUnsignedTransaction(
		{ format: 'nexu', sender: sender.address, receiver, amount, fee },
		nonce,
	)
	if (!built.status || built.tx === undefined) {
		throw new Error(built.error ?? 'gagal menyusun transaksi')
	}
	const signed = signTransaction(built.tx, sender.privateKey)
	const result = await rpc<{
		status: boolean
		txHash?: string
		error?: string
	}>('nex_sendRawTransaction', [encodeTx(signed)])
	if (!result.status) {
		throw new Error(result.error ?? 'transaksi ditolak node')
	}
	return result.txHash ?? signed.txHash ?? ''
}

export const waitForNonce = async (
	address: string,
	target: number,
	label: string,
): Promise<void> => {
	const pollMs = numEnv('NEX_LOAD_POLL_MS', 10000)
	for (;;) {
		const account = await getAccount(address)
		if (account.nonce >= target) return
		console.log(
			`${label}: menunggu blok — nonce ${account.nonce}/${target}. ` +
				'Jalankan miner di terminal Anda bila belum.',
		)
		await sleep(pollMs)
	}
}

const require = createRequire(import.meta.url)
const qrcode = require('qrcode') as {
	toString(text: string, options: { type: 'terminal'; small: boolean }): Promise<string>
}

const printQr = async (text: string): Promise<void> => {
	console.log(await qrcode.toString(text, { type: 'terminal', small: true }))
}

const fund = async (): Promise<void> => {
	await checkNode()
	mkdirSync(DATA_DIR, { recursive: true })

	let seed: string
	if (existsSync(SEED_FILE)) {
		seed = loadSeed()
		console.log('Seed existing dipakai ulang dari data/loadtest/seed.txt')
	} else {
		seed = genRandomMnemonic()
		writeFileSync(SEED_FILE, seed + '\n', { mode: 0o600 })
		console.log('SEED BARU (jangan dipakai untuk dana sungguhan):')
		console.log(seed)
	}

	const wallet = deriveWallet(seed)
	const bank = wallet(0)
	const senders = Array.from({ length: SENDERS }, (_, i) => wallet(i + 1))
	const receivers = Array.from(
		{ length: RECEIVER_COUNT },
		(_, i) => wallet(RECEIVER_START + i).address,
	)

	console.log('\nAlamat bank utama:')
	console.log(bank.address)
	await printQr(bank.address)

	const targetTx = numEnv('NEX_LOAD_TX_COUNT', 5000)
	const rounds = Math.ceil(targetTx / (SENDERS * PENDING_PER_SENDER))
	const childFundNexu =
		rounds * PENDING_PER_SENDER * (AMOUNT_NEXU + FEE_NEXU) * 2
	const needNexu = parseNxc(String(numEnv('NEX_LOAD_MIN_NXC', 1)))
	const fundCostNexu = SENDERS * (childFundNexu + FEE_NEXU)

	console.log(
		`\nTarget ${targetTx} tx → ${rounds} round, ${senders.length} pengirim.`,
	)
	console.log(
		`Setiap pengirim perlu ${formatNxc(childFundNexu)} NXC; total funding ` +
			`${formatNxc(fundCostNexu)} NXC.`,
	)
	console.log(
		`Menunggu saldo bank ≥ ${formatNxc(needNexu)} NXC ` +
			`(cukup untuk funding: ${formatNxc(fundCostNexu)} NXC).`,
	)

	const pollMs = numEnv('NEX_LOAD_POLL_MS', 10000)
	for (;;) {
		const account = await getAccount(bank.address)
		if (account.balance >= needNexu && account.balance >= fundCostNexu) {
			console.log(`Saldo bank ${formatNxc(account.balance)} NXC — lanjut.`)
			break
		}
		console.log(
			`Saldo bank ${formatNxc(account.balance)} NXC — menunggu deposit ` +
				`(kirim NXC ke alamat QR di atas).`,
		)
		await sleep(pollMs)
	}

	const previous = existsSync(STATE_FILE) ? readState() : undefined
	if (previous !== undefined && previous.bank !== bank.address) {
		throw new Error('State lama tidak cocok dengan seed — hapus data/loadtest/state.json.')
	}
	const state: LoadState = previous ?? {
		bank: bank.address,
		senders: senders.map((item) => item.address),
		receivers,
		targetTx,
		childFundNexu,
		fundedCount: 0,
		funded: false,
	}
	if (previous !== undefined && previous.targetTx !== targetTx) {
		console.log(
			`Target env ${targetTx} berbeda dengan state ${previous.targetTx}; ` +
				'state lama dipakai. Hapus data/loadtest/state.json untuk reset.',
		)
	}
	writeState(state)

	for (let base = state.fundedCount; base < SENDERS; base += PENDING_PER_SENDER) {
		const batch = senders.slice(base, base + PENDING_PER_SENDER)
		const startNonce = await getNextNonce(bank.address)
		for (let i = 0; i < batch.length; i++) {
			const hash = await submit(
				bank,
				startNonce + i,
				batch[i].address,
				childFundNexu,
				FEE_NEXU,
			)
			console.log(
				`fund ${base + i + 1}/${SENDERS} → ${batch[i].address} ` +
					`${hash.slice(0, 18)}…`,
			)
		}
		await waitForNonce(
			bank.address,
			startNonce + batch.length,
			`funding batch ${base + batch.length}/${SENDERS}`,
		)
		state.fundedCount = base + batch.length
		writeState(state)
	}

	const short: string[] = []
	for (const sender of senders) {
		const account = await getAccount(sender.address)
		if (account.balance < childFundNexu) {
			short.push(`${sender.address}: ${formatNxc(account.balance)} NXC`)
		}
	}
	if (short.length > 0) {
		throw new Error(`Funding belum cukup:\n${short.join('\n')}`)
	}

	state.funded = true
	writeState(state)
	console.log(
		`\nFunding ${SENDERS} alamat selesai. Jalankan: bun loadtest/spam.ts`,
	)
}

const isMain =
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
	fund().catch((error: unknown) => {
		console.error(errMsg(error))
		process.exitCode = 1
	})
}
