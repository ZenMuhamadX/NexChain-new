/**
 * Gate offline untuk Stage 1 dari gateway MetaMask.
 *
 * Jalankan:  bun run check:metamask
 *
 * Tidak menyalakan server / node: yang diuji adalah logika murni di
 * `apps/metamask-gateway/bridge.ts` — registrasi EIP-191, mapping alamat,
 * konversi satuan, dan allowlist method.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ec as EC } from 'elliptic'
import { keccak256 } from 'js-sha3'

const MAPPING_PATH = path.join(
	process.env.TEMP ?? os.tmpdir(),
	`nexchain-mm-gateway-check-${process.pid}.json`,
)
fs.rmSync(MAPPING_PATH, { force: true })
process.env.METAMASK_BRIDGE_MAPPING = MAPPING_PATH

const bridge = await import('../apps/metamask-gateway/bridge')

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

const { CHAIN_ID } = await import('../src/crypto/chainId')
const { generateAddressFromPublicKey } =
	await import('../src/crypto/generateAddressFromPublicKey')

const ec = new EC('secp256k1')
const PRIVATE_KEY =
	'4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'
const key = ec.keyFromPrivate(PRIVATE_KEY, 'hex')
const uncompressed = key.getPublic(false, 'hex')
// PENTING: keccak atas BYTE pubkey, bukan string hex-nya (js-sha3 meng-hash
// string apa adanya). Ini jebakan yang bikin alamat MetaMask salah.
const ethAddress = `0x${keccak256(Buffer.from(uncompressed.slice(2), 'hex')).slice(-40)}`

const signMessage = (message: string) => {
	const hash = bridge.eip191Hash(message)
	const signature = ec.sign(hash, key, { canonical: true })
	return {
		r: signature.r.toString(16, 64),
		s: signature.s.toString(16, 64),
		v: (signature.recoveryParam ?? 0) + 27,
	}
}
const hexSignature = (sig: { r: string; s: string; v: number }): string =>
	`0x${sig.r}${sig.s}${sig.v.toString(16).padStart(2, '0')}`

console.log('GROUP 1 — allowlist (jangan sampai method tulis tembus):')
for (const method of [
	'eth_chainId',
	'eth_getBalance',
	'eth_getTransactionCount',
	'eth_getTransactionReceipt',
])
	ok(`${method} diizinkan`, bridge.ALLOWED_METHODS.has(method))
for (const method of [
	'nex_getWork',
	'nex_submitWork',
	'nex_sendTransaction',
	'nex_sendRawTransaction',
	'eth_sendRawTransaction',
	'eth_sign',
	'personal_sign',
	'wallet_switchEthereumChain',
	'wallet_addEthereumChain',
])
	ok(`${method} DITOLAK`, !bridge.ALLOWED_METHODS.has(method))

console.log('GROUP 2 — konversi alamat / hash / satuan:')
ok(
	'chainId hex sesuai konstanta',
	bridge.CHAIN_ID_HEX === `0x${CHAIN_ID.toString(16)}`,
	bridge.CHAIN_ID_HEX,
)
ok(
	'chainId dinormalisasi (hex / angka / kapital)',
	bridge.normalizeChainId(CHAIN_ID) === bridge.CHAIN_ID_HEX &&
		bridge.normalizeChainId(String(CHAIN_ID)) === bridge.CHAIN_ID_HEX &&
		bridge.normalizeChainId(bridge.CHAIN_ID_HEX.toUpperCase()) ===
			bridge.CHAIN_ID_HEX &&
		bridge.normalizeChainId(` ${bridge.CHAIN_ID_HEX} `) ===
			bridge.CHAIN_ID_HEX &&
		bridge.normalizeChainId('0x1') !== bridge.CHAIN_ID_HEX &&
		bridge.normalizeChainId('bukan-chain-id') === null,
)
const HEX40 = 'ab'.repeat(20)
const HEX64 = 'ab'.repeat(32)
ok(
	'NxC → 0x (lowercase)',
	bridge.nexToEthAddress(`NxC${HEX40}`) === `0x${HEX40}`,
)
ok(
	'0x → TxC (digest sama, prefix diganti)',
	bridge.toNexHash(`0x${'AB'.repeat(32)}`) === `TxC${HEX64}`,
)
ok('TxC → 0x', bridge.toEthHash(`TxC${HEX64}`) === `0x${HEX64}`)
ok(
	'1 nexu = 10^10 wei (BigInt, tanpa artefak float)',
	bridge.nexuToWeiHex(1) === `0x${(10n ** 10n).toString(16)}` &&
		bridge.nexuToWeiHex(123456789) ===
			`0x${(123456789n * 10n ** 10n).toString(16)}`,
)
ok(
	'wei → NXC 8 desimal eksak',
	bridge.formatWeiAsNxc(bridge.nexuToWeiHex(1)) === '0.00000001' &&
		bridge.formatWeiAsNxc(bridge.nexuToWeiHex(123456789)) === '1.23456789' &&
		bridge.formatWeiAsNxc('0x0') === '0.00000000',
)
ok(
	'gas price iklan = 1 nexu/gas',
	bridge.GAS_PRICE_WEI === 10n ** 10n &&
		bridge.GAS_PRICE_HEX === `0x${(10n ** 10n).toString(16)}`,
)
ok(
	'alamat/hash invalid ditolak',
	throws(() => bridge.nexToEthAddress('0x123')) &&
		throws(() => bridge.toEthHash('0x123')) &&
		throws(() => bridge.toNexHash('TxC123')),
)

console.log('GROUP 3 — registrasi EIP-191:')
const nonce = bridge.issueNonce()
const message = bridge.registrationMessage(nonce)
ok(
	'pesan memuat chainId + nonce',
	message.includes(`chainId: ${CHAIN_ID}`) && message.includes(nonce),
	JSON.stringify(message),
)
ok(
	'prefix EIP-191 persis "\\x19Ethereum Signed Message:\\n<panjang>"',
	Buffer.from(bridge.eip191Hash(message)).toString('hex') ===
		keccak256(
			Buffer.concat([
				Buffer.from(
					`\x19Ethereum Signed Message:\n${Buffer.byteLength(message)}`,
				),
				Buffer.from(message, 'utf8'),
			]),
		),
)

const result = bridge.verifyRegistration(
	ethAddress,
	nonce,
	hexSignature(signMessage(message)),
)
const expectedNex = generateAddressFromPublicKey(key.getPublic(true, 'hex'))
ok(
	'recover menghasilkan alamat Ethereum yang sama',
	result.eth === ethAddress,
	`${result.eth} vs ${ethAddress}`,
)
ok(
	'recover menghasilkan alamat NexChain asli',
	result.nex === expectedNex,
	`${result.nex} vs ${expectedNex}`,
)
ok(
	'akun MetaMask beda → ditolak',
	throws(() =>
		bridge.verifyRegistration(
			'0x0000000000000000000000000000000000000001',
			nonce,
			hexSignature(signMessage(message)),
		),
	),
)
ok(
	'tanda tangan untuk pesan lain → ditolak',
	throws(() =>
		bridge.verifyRegistration(
			ethAddress,
			nonce,
			hexSignature(signMessage(bridge.registrationMessage('nonce-lain'))),
		),
	),
)
const canonicalSig = signMessage(message)
const order = BigInt(`0x${ec.curve.n.toString(16)}`)
const highS = (order - BigInt(`0x${canonicalSig.s}`))
	.toString(16)
	.padStart(64, '0')
ok(
	'high-S (EIP-2) ditolak',
	throws(() =>
		bridge.verifyRegistration(
			ethAddress,
			nonce,
			hexSignature({
				r: canonicalSig.r,
				s: highS,
				v: canonicalSig.v === 27 ? 28 : 27,
			}),
		),
	),
)
ok(
	'signature pendek / v asing ditolak',
	throws(() => bridge.verifyRegistration(ethAddress, nonce, '0x1234')) &&
		throws(() =>
			bridge.verifyRegistration(
				ethAddress,
				nonce,
				`${canonicalSig.r}${canonicalSig.s}ff`,
			),
		),
)

console.log('GROUP 4 — nonce sekali pakai + mapping persisten:')
ok('nonce baru berlaku', bridge.consumeNonce(nonce))
ok('nonce yang sama ditolak pakai kedua', !bridge.consumeNonce(nonce))
ok('nonce rekaan ditolak', !bridge.consumeNonce('nonce-palsu'))
bridge.setMapping(result.eth, result.nex)
ok(
	'mapping tersimpan & dibaca lowercase',
	bridge.getNexForEth(ethAddress.toUpperCase()) === result.nex,
)
ok(
	'mapping ditulis ke disk dengan write atomik',
	JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')).mappings.length === 1,
)
fs.rmSync(MAPPING_PATH, { force: true })

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
