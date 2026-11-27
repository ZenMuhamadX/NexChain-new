/**
 * Logika murni gateway MetaMask: mapping alamat, registrasi EIP-191,
 * konversi satuan, dan allowlist method.
 *
 * Modul ini sengaja bebas dari Express/supervisor supaya bisa diuji oleh
 * `scripts/metamaskGatewayCheck.ts` tanpa menyalakan server atau node.
 */
import fs from 'node:fs'
import path from 'node:path'
import { CHAIN_ID, encodeV } from 'src/crypto/chainId'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import { recoverPublicKey } from 'src/crypto/recoverPublicKey'
import { keccak256 } from 'src/core/encoding/keccak256'
import { sha256 } from 'src/core/encoding/sha256'
import { dataPath } from 'src/core/state/db/dataDir'

export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`

/**
 * MetaMask bisa mengembalikan chainId sebagai `"0x7da"`, `"0X7DA"`,
 * `"2010"`, atau angka 2010 (default). Semua dinormalisasi supaya
 * perbandingan tidak gagal hanya karena format.
 */
export const normalizeChainId = (value: unknown): string | null => {
	if (typeof value === 'number')
		return Number.isSafeInteger(value) && value >= 0
			? `0x${value.toString(16)}`
			: null
	if (typeof value !== 'string') return null
	const text = value.trim().toLowerCase()
	if (/^(0x[0-9a-f]+|[0-9]+)$/.test(text))
		return `0x${BigInt(text).toString(16)}`
	return null
}

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
	'eth_getBlockByHash',
	'eth_getTransactionByHash',
	'eth_getTransactionReceipt',
	'eth_sendRawTransaction',
])

// ---------------------------------------------------------------------------
// RPC ke node (server-side, memakai kredensial jika ada). Env dibaca per
// request karena `config()` gateway dipanggil setelah modul ini dievaluasi.
// ---------------------------------------------------------------------------

export const nodeRpc = async (
	method: string,
	params: unknown[] = [],
): Promise<any> => {
	const url = process.env.NEX_RPC_URL || 'http://127.0.0.1:8000/rpc'
	const user = process.env.RPC_USER
	const password = process.env.RPC_PASSWORD
	const headers: Record<string, string> = { 'content-type': 'application/json' }
	if (user && password)
		headers.authorization =
			'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')

	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	if (!response.ok) {
		const hint =
			response.status === 401 || response.status === 403
				? ' — cek NEX_RPC_URL gateway (jangan ke proxy/Envoy) dan RPC_USER/RPC_PASSWORD'
				: ''
		throw new Error(`node RPC ${method} HTTP ${response.status}${hint}`)
	}

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

/**
 * 20 byte alamat adalah identitas akun; `NxC` dan `0x` cuma prefix tampilan.
 * Akun yang dipakai MetaMask memang sengaja memakai 20 byte Ethereum apa
 * adanya, supaya `to` di raw tx tidak perlu diubah (tanda tangan mengikatnya).
 */
export const nexToEthAddress = (address: string): string => {
	if (!/^NxC[0-9a-f]{40}$/.test(address))
		throw new Error(`alamat NexChain tidak valid: ${address}`)
	return `0x${address.slice(3)}`
}

/** `0x…` → `NxC…`, kebalikan `nexToEthAddress`. */
export const ethToNexAddress = (address: string): string => {
	if (!/^0x[0-9a-fA-F]{40}$/.test(address))
		throw new Error(`alamat Ethereum tidak valid: ${address}`)
	return `NxC${address.slice(2).toLowerCase()}`
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

/**
 * wei (18 desimal) → string NXC 8 desimal, eksak tanpa float.
 * Sengaja tidak merujuk konstanta modul: fungsi ini disuntikkan juga ke
 * halaman onboarding lewat `toString()`.
 */
export const formatWeiAsNxc = (weiHex: string): string => {
	const nexu = BigInt(weiHex) / 10n ** 10n
	return `${nexu / 10n ** 8n}.${(nexu % 10n ** 8n).toString().padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Mapping 0xA… ↔ NxB…
// ---------------------------------------------------------------------------

const MAPPING_FILE =
	process.env.METAMASK_BRIDGE_MAPPING ?? dataPath('bridge', 'mappings.json')

interface StoredPair {
	eth: string
	nex: string
}

const mappings = new Map<string, string>()
const ethByNex = new Map<string, string>()
const nexByEthHash = new Map<string, string>()
const ethByNexHash = new Map<string, string>()

const persistMappings = (): void => {
	fs.mkdirSync(path.dirname(MAPPING_FILE), { recursive: true })
	const tmp = `${MAPPING_FILE}.tmp`
	fs.writeFileSync(
		tmp,
		JSON.stringify(
			{
				mappings: [...mappings].map(([eth, nex]) => ({ eth, nex })),
				hashes: [...nexByEthHash].map(([eth, nex]) => ({ eth, nex })),
			},
			null,
			2,
		),
	)
	fs.renameSync(tmp, MAPPING_FILE)
}

const loadMappings = (): void => {
	try {
		const raw = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8')) as {
			mappings?: StoredPair[]
			hashes?: StoredPair[]
		}
		for (const entry of raw.mappings ?? []) {
			mappings.set(entry.eth.toLowerCase(), entry.nex)
			ethByNex.set(entry.nex, entry.eth.toLowerCase())
		}
		for (const entry of raw.hashes ?? []) {
			nexByEthHash.set(entry.eth.toLowerCase(), entry.nex)
			ethByNexHash.set(entry.nex, entry.eth.toLowerCase())
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
}
loadMappings()

export const getNexForEth = (eth: string): string | undefined =>
	mappings.get(eth.toLowerCase())

export const getEthForNex = (nex: string): string | undefined =>
	ethByNex.get(nex)

export const setMapping = (eth: string, nex: string): void => {
	const key = eth.toLowerCase()
	mappings.set(key, nex)
	ethByNex.set(nex, key)
	persistMappings()
}

/** `0x<keccak(raw)>` → `TxC<sha256(0x03 ‖ raw)>`. */
export const getNexHashForEth = (hash: string): string | undefined =>
	nexByEthHash.get(hash.toLowerCase())

export const getEthHashForNex = (hash: string): string | undefined =>
	ethByNexHash.get(hash)

export const setTxHashMapping = (ethHash: string, nexHash: string): void => {
	nexByEthHash.set(ethHash.toLowerCase(), nexHash)
	ethByNexHash.set(nexHash, ethHash.toLowerCase())
	persistMappings()
}

/** Hash eth dan hash node dari satu raw tx Ethereum. */
export const hashEthTx = (raw: Uint8Array): { eth: string; nex: string } => {
	const payload = new Uint8Array(raw.length + 1)
	payload[0] = 0x03
	payload.set(raw, 1)
	return {
		eth: `0x${keccak256(raw)}`,
		nex: `TxC${sha256(payload, 'hex') as string}`,
	}
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

const addressFromPublicKey = (publicKey: string): string =>
	nexToEthAddress(generateAddressFromPublicKey(publicKey))

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
	// `encodeV` (bukan literal 87) supaya v selalu mengikuti CHAIN_ID aktif;
	// literal 87 hanya benar untuk chain id 26 dan membuat registrasi gagal
	// total setelah fork chain id.
	const { publicKey } = recoverPublicKey(hash, {
		v: encodeV(recovery),
		r,
		s,
	})

	const eth = addressFromPublicKey(publicKey)
	if (eth.toLowerCase() !== account.toLowerCase())
		throw new Error('signature tidak cocok dengan akun MetaMask')

	return { eth, nex: ethToNexAddress(eth) }
}
