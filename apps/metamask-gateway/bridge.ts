/**
 * Logika murni gateway MetaMask: mapping alamat, registrasi EIP-191,
 * konversi satuan, dan allowlist method.
 *
 * Modul ini sengaja bebas dari Express/supervisor supaya bisa diuji oleh
 * `scripts/metamaskGatewayCheck.ts` tanpa menyalakan server atau node.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ec as EC } from 'elliptic'
import { CHAIN_ID } from 'src/crypto/chainId'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { recoverPublicKey } from 'src/crypto/recoverPublicKey'
import { keccak256 } from 'src/core/encoding/keccak256'
import { dataPath } from 'src/core/state/db/dataDir'

const ec = new EC('secp256k1')

export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`

/** 10 gwei — dengan 8 desimal NXC, 1 gas = 1 nexu. */
export const GAS_PRICE_WEI = 10_000_000_000n
export const GAS_PRICE_HEX = `0x${GAS_PRICE_WEI.toString(16)}`
const WEI_PER_NEXU = 10n ** 10n

/**
 * Hanya method baca yang boleh lewat gateway. MetaMask tidak bisa mengirim
 * Basic Auth, jadi endpoint ini TIDAK boleh meneruskan method tulis node —
 * terutama `nex_getWork`/`nex_submitWork`.
 */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
	'eth_chainId',
	'net_version',
	'eth_blockNumber',
	'eth_getBalance',
	'eth_getTransactionCount',
	'eth_gasPrice',
	'eth_estimateGas',
	'eth_call',
	'eth_getCode',
	'eth_getLogs',
	'eth_getBlockByNumber',
	'eth_getTransactionByHash',
	'eth_getTransactionReceipt',
])

// ---------------------------------------------------------------------------
// RPC ke node (server-side, memakai kredensial jika ada)
// ---------------------------------------------------------------------------

const NODE_RPC_URL = process.env.NEX_RPC_URL || 'http://127.0.0.1:8000/rpc'
const NODE_USER = process.env.RPC_USER
const NODE_PASSWORD = process.env.RPC_PASSWORD

export const nodeRpc = async (
	method: string,
	params: unknown[] = [],
): Promise<any> => {
	const headers: Record<string, string> = { 'content-type': 'application/json' }
	if (NODE_USER && NODE_PASSWORD)
		headers.authorization =
			'Basic ' + Buffer.from(`${NODE_USER}:${NODE_PASSWORD}`).toString('base64')

	const response = await fetch(NODE_RPC_URL, {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	if (!response.ok)
		throw new Error(`node RPC ${method} HTTP ${response.status}`)

	const body = (await response.json()) as {
		result?: any
		error?: { message?: string }
	}
	if (body.error)
		throw new Error(body.error.message ?? `node RPC ${method} error`)
	return body.result
}

// ---------------------------------------------------------------------------
// Konversi alamat / hash / satuan
// ---------------------------------------------------------------------------

/** `NxC…` → `0x…`. Dipakai untuk menampilkan tx node ke MetaMask. */
export const nexToEthAddress = (address: string): string => {
	if (!/^NxC[0-9a-f]{40}$/.test(address))
		throw new Error(`alamat NexChain tidak valid: ${address}`)
	return `0x${address.slice(3)}`
}

/** `TxC…` → `0x…` (digest sama, beda prefix saja). */
export const toEthHash = (hash: string): string => {
	if (!/^TxC[0-9a-f]{64}$/.test(hash))
		throw new Error(`hash tx tidak valid: ${hash}`)
	return `0x${hash.slice(3)}`
}

/** `0x…` → `TxC…`. */
export const toNexHash = (hash: string): string => {
	if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
		throw new Error(`hash eth tidak valid: ${hash}`)
	return `TxC${hash.slice(2).toLowerCase()}`
}

export const toHexQuantity = (value: number): string => {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`nilai tidak bisa jadi quantity: ${value}`)
	return `0x${value.toString(16)}`
}

/** Saldo nexu (8 desimal) → wei (18 desimal) persis, tanpa float. */
export const nexuToWeiHex = (nexu: number): string => {
	if (!Number.isSafeInteger(nexu) || nexu < 0)
		throw new Error(`saldo nexu tidak valid: ${nexu}`)
	return `0x${(BigInt(nexu) * WEI_PER_NEXU).toString(16)}`
}

// ---------------------------------------------------------------------------
// Mapping 0xA… ↔ NxB…
// ---------------------------------------------------------------------------

const MAPPING_FILE =
	process.env.METAMASK_BRIDGE_MAPPING ?? dataPath('bridge', 'mappings.json')

interface StoredMapping {
	eth: string
	nex: string
}

const mappings = new Map<string, string>()

const loadMappings = (): void => {
	try {
		const raw = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8')) as {
			mappings?: StoredMapping[]
		}
		for (const entry of raw.mappings ?? [])
			mappings.set(entry.eth.toLowerCase(), entry.nex)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
}
loadMappings()

export const getNexForEth = (eth: string): string | undefined =>
	mappings.get(eth.toLowerCase())

export const setMapping = (eth: string, nex: string): void => {
	mappings.set(eth.toLowerCase(), nex)
	fs.mkdirSync(path.dirname(MAPPING_FILE), { recursive: true })
	const tmp = `${MAPPING_FILE}.tmp`
	fs.writeFileSync(
		tmp,
		JSON.stringify(
			{
				mappings: [...mappings].map(([ethKey, nexValue]) => ({
					eth: ethKey,
					nex: nexValue,
				})),
			},
			null,
			2,
		),
	)
	fs.renameSync(tmp, MAPPING_FILE)
}

// Nonce registrasi: sekali pakai, kedaluwarsa 5 menit.
const pendingNonces = new Map<string, number>()
const NONCE_TTL_MS = 5 * 60_000

export const issueNonce = (): string => {
	for (const [nonce, expiresAt] of pendingNonces)
		if (expiresAt < Date.now()) pendingNonces.delete(nonce)

	const nonce = Buffer.from(
		crypto.getRandomValues(new Uint8Array(16)),
	).toString('hex')
	pendingNonces.set(nonce, Date.now() + NONCE_TTL_MS)
	return nonce
}

export const consumeNonce = (nonce: string): boolean => {
	const expiresAt = pendingNonces.get(nonce)
	if (expiresAt === undefined || expiresAt < Date.now()) return false
	pendingNonces.delete(nonce)
	return true
}

// ---------------------------------------------------------------------------
// Registrasi lewat personal_sign
// ---------------------------------------------------------------------------

export const registrationMessage = (nonce: string): string =>
	[
		'NexChain wallet registration',
		`chainId: ${CHAIN_ID}`,
		`nonce: ${nonce}`,
	].join('\n')

/** EIP-191: keccak("\x19Ethereum Signed Message:\n" + panjang + pesan). */
export const eip191Hash = (message: string): Uint8Array => {
	const payload = Buffer.from(message, 'utf8')
	const prefix = Buffer.from(
		`\x19Ethereum Signed Message:\n${payload.length}`,
		'utf8',
	)
	return Buffer.from(keccak256(Buffer.concat([prefix, payload])), 'hex')
}

const parseSignature = (
	signature: string,
): { r: string; s: string; recovery: number } => {
	const hex = signature.startsWith('0x') ? signature.slice(2) : signature
	if (!/^[0-9a-fA-F]{130}$/.test(hex))
		throw new Error('signature harus 65 byte hex')

	const v = Number.parseInt(hex.slice(128), 16)
	const eip155V = CHAIN_ID * 2 + 35
	let recovery: number
	if (v === 0 || v === 1) recovery = v
	else if (v === 27 || v === 28) recovery = v - 27
	else if (v === eip155V || v === eip155V + 1) recovery = v - eip155V
	else throw new Error(`v tidak dikenal: ${v}`)

	return { r: hex.slice(0, 64), s: hex.slice(64, 128), recovery }
}

const addressFromPublicKey = (publicKey: string): string => {
	const uncompressed = ec
		.keyFromPublic(publicKey, 'hex')
		.getPublic(false, 'hex')
	return `0x${keccak256(Buffer.from(uncompressed.slice(2), 'hex')).slice(-40)}`
}

export interface RegistrationResult {
	eth: string
	nex: string
}

/**
 * Verifikasi tanda tangan registrasi dan kembalikan DUA alamat yang dikontrol
 * private key yang sama: alamat Ethereum `0x…` dan alamat NexChain `NxC…`.
 * `account` dari MetaMask wajib cocok dengan alamat hasil recovery.
 */
export const verifyRegistration = (
	account: string,
	nonce: string,
	signature: string,
): RegistrationResult => {
	if (!/^0x[0-9a-fA-F]{40}$/.test(account))
		throw new Error('alamat MetaMask tidak valid')

	const hash = eip191Hash(registrationMessage(nonce))
	const { r, s, recovery } = parseSignature(signature)
	const { publicKey } = recoverPublicKey(hash, {
		v: recovery + 87,
		r,
		s,
	})

	const eth = addressFromPublicKey(publicKey)
	if (eth.toLowerCase() !== account.toLowerCase())
		throw new Error('signature tidak cocok dengan akun MetaMask')

	return { eth, nex: generateAddressFromPublicKey(publicKey) }
}
