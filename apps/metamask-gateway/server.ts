/**
 * Gateway MetaMask — proses TERPILAH dari node.
 *
 * Node tetap memakai Basic Auth + CORS ketat di loopback. Gateway ini yang
 * bicara `eth_*` ke MetaMask (CORS longgar, tanpa credentials) dan meneruskan
 * method baca plus `eth_sendRawTransaction` ke node lewat `nex_*`. Method tulis
 * lain (`nex_getWork`, `nex_submitWork`, `eth_sign`, …) tidak pernah diteruskan.
 */
import './env'
import express, { ErrorRequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import {
	CHAIN_ID_HEX,
	consumeNonce,
	ethToNexAddress,
	formatWeiAsNxc,
	GAS_PRICE_HEX,
	getEthForNex,
	getEthHashForNex,
	getNexHashForEth,
	hashEthTx,
	issueNonce,
	nexToEthAddress,
	normalizeChainId,
	nodeRpc,
	nexuToWeiHex,
	setMapping,
	setTxHashMapping,
	toEthHash,
	toHexQuantity,
	toNexHash,
	verifyRegistration,
} from './bridge'
import { uint8ToBase64 } from 'src/core/encoding/hex/base64/uint8ToBase64'

const PORT = Number(process.env.METAMASK_GATEWAY_PORT ?? 8545)
const GAS_LIMIT_HEX = '0x5208' // 21000 — prototype, belum ada EVM
console.log(
	`Gateway → node: ${process.env.NEX_RPC_URL ?? '(default 127.0.0.1:8000)'} ` +
		`(auth: ${process.env.RPC_USER && process.env.RPC_PASSWORD ? 'Basic' : 'none'})`,
)

const app = express()
app.disable('x-powered-by')
// cloudflared konek dari loopback dan menyisipkan X-Forwarded-For.
app.set('trust proxy', 'loopback')
app.use(helmet({ contentSecurityPolicy: false }))
app.use(
	cors({
		origin: '*', // data chain publik; TANPA credentials
		methods: ['GET', 'POST'],
		allowedHeaders: ['Content-Type'],
	}),
)
app.use(
	rateLimit({
		windowMs: 60_000,
		limit: 300,
		standardHeaders: 'draft-7',
		legacyHeaders: false,
	}),
)
app.use(express.json({ limit: '256kb' }))

const param = (params: unknown, index: number): unknown =>
	Array.isArray(params) ? params[index] : params

const asString = (params: unknown, index: number): string => {
	const value = param(params, index)
	if (typeof value !== 'string') throw new Error('parameter harus string')
	return value
}

const parseBlockNumber = (tag: string): number => {
	if (tag === 'latest' || tag === 'pending') return -1
	if (tag === 'earliest') return 0
	if (tag.startsWith('0x')) return Number.parseInt(tag, 16)
	return Number.parseInt(tag, 10)
}

interface EthTx {
	hash: string
	nonce: string
	blockHash: string | null
	blockNumber: string | null
	transactionIndex: string | null
	from: string
	to: string
	value: string
	gas: string
	gasPrice: string
	input: string
	v: string
	r: string
	s: string
}

const displayEthAddress = (nex: string): string =>
	getEthForNex(nex) ?? nexToEthAddress(nex)

const lookupHash = (hash: string): string =>
	getNexHashForEth(hash) ?? toNexHash(hash)

const toEthTx = (record: any): EthTx => {
	const meta = record.metadata as
		{ blockHeight: number; blockHash: string } | undefined
	const sign = record.sign as { v: number; r: string; s: string } | undefined
	const prefix32 = (value: string): string =>
		`0x${value.replace(/^0x/, '').padStart(64, '0')}`
	return {
		hash: getEthHashForNex(record.txHash) ?? toEthHash(record.txHash),
		nonce: toHexQuantity(record.nonce),
		blockHash: meta ? `0x${meta.blockHash}` : null,
		blockNumber: meta ? toHexQuantity(meta.blockHeight) : null,
		transactionIndex: meta ? '0x0' : null,
		from: displayEthAddress(record.from),
		to: displayEthAddress(record.receiver),
		value: nexuToWeiHex(record.amount),
		gas: GAS_LIMIT_HEX,
		gasPrice: GAS_PRICE_HEX,
		input: typeof record.data === 'string' ? record.data : '0x',
		v: sign ? toHexQuantity(sign.v) : '0x0',
		r: sign ? prefix32(sign.r) : prefix32('0'),
		s: sign ? prefix32(sign.s) : prefix32('0'),
	}
}

const toEthBlock = (block: any, fullTx: boolean) => {
	const body = block.block ?? block
	return {
		number: toHexQuantity(body.height),
		hash: `0x${body.header.hash}`,
		parentHash: `0x${body.header.previousBlockHash}`,
		timestamp: toHexQuantity(body.header.timestamp),
		miner: displayEthAddress(body.minerId),
		gasLimit: GAS_LIMIT_HEX,
		gasUsed: '0x0',
		// Jangan sertakan kolom base fee: MetaMask akan kirim tx tipe 2 yang
		// tidak bisa dibaca node (node hanya menerima 0x03 ‖ legacy RLP).
		transactions: (body.transactions ?? []).map((tx: any) =>
			fullTx ? toEthTx(tx) : toEthHash(tx.txHash),
		),
	}
}

const handleRpc = async (method: string, params: unknown): Promise<any> => {
	switch (method) {
		case 'eth_chainId':
			return CHAIN_ID_HEX
		case 'net_version':
			return String(Number(CHAIN_ID_HEX))
		case 'eth_gasPrice':
		case 'eth_maxPriorityFeePerGas':
			return GAS_PRICE_HEX
		case 'eth_estimateGas':
			return GAS_LIMIT_HEX
		case 'eth_call':
		case 'eth_getCode':
			return '0x'
		case 'eth_getLogs':
			return []
		case 'eth_blockNumber': {
			const state = await nodeRpc('nex_getBlockState')
			return toHexQuantity(state.currentBlockHeight)
		}
		case 'eth_getBalance': {
			const nex = ethToNexAddress(asString(params, 0))
			const account = await nodeRpc('nex_getAccount', [nex])
			return nexuToWeiHex(account?.balance ?? 0)
		}
		case 'eth_getTransactionCount': {
			const nex = ethToNexAddress(asString(params, 0))
			const tag = param(params, 1)
			const nonce =
				tag === 'pending'
					? await nodeRpc('nex_getNextNonce', [nex])
					: ((await nodeRpc('nex_getNonceAccount', [nex])) ?? 0)
			return toHexQuantity(nonce)
		}
		case 'eth_getBlockByNumber': {
			const tag = asString(params, 0)
			const height = parseBlockNumber(tag)
			const block =
				height < 0
					? await nodeRpc('nex_getCurrentBlock')
					: await nodeRpc('nex_getBlockByHeight', [height])
			return block ? toEthBlock(block, param(params, 1) === true) : null
		}
		case 'eth_getBlockByHash': {
			// Node menyimpan kunci `blockHash:<hex>` tanpa prefix 0x.
			const hash = asString(params, 0).replace(/^0x/, '')
			const block = await nodeRpc('nex_getBlockByHash', [hash])
			return block ? toEthBlock(block, param(params, 1) === true) : null
		}
		case 'eth_getTransactionByHash': {
			const hash = asString(params, 0)
			try {
				const record = await nodeRpc('nex_getTransactionByTxHash', [
					lookupHash(hash),
				])
				return record ? toEthTx(record) : null
			} catch (error) {
				logRpc(
					method,
					brief(hash),
					'→ null (ERROR)',
					error instanceof Error ? error.message : String(error),
				)
				return null
			}
		}
		case 'eth_getTransactionReceipt': {
			const hash = asString(params, 0)
			try {
				const record = await nodeRpc('nex_getTransactionByTxHash', [
					lookupHash(hash),
				])
				if (!record?.metadata) return null // pending belum punya receipt
				const tx = toEthTx(record)
				return {
					transactionHash: tx.hash,
					transactionIndex: '0x0',
					blockHash: tx.blockHash,
					blockNumber: tx.blockNumber,
					from: tx.from,
					to: tx.to,
					cumulativeGasUsed: GAS_LIMIT_HEX,
					gasUsed: GAS_LIMIT_HEX,
					contractAddress: null,
					logs: [],
					status: '0x1',
					effectiveGasPrice: GAS_PRICE_HEX,
					type: '0x0',
				}
			} catch (error) {
				logRpc(
					method,
					brief(hash),
					'→ null (ERROR)',
					error instanceof Error ? error.message : String(error),
				)
				return null
			}
		}
		case 'eth_sendRawTransaction': {
			const rawHex = asString(params, 0)
			if (!/^0x[0-9a-fA-F]+$/.test(rawHex) || rawHex.length % 2 !== 0)
				throw new Error('raw transaction harus hex berpasangan')
			const raw = new Uint8Array(Buffer.from(rawHex.slice(2), 'hex'))
			const hashes = hashEthTx(raw)
			const payload = new Uint8Array(raw.length + 1)
			payload[0] = 0x03
			payload.set(raw, 1)
			const result = await nodeRpc('nex_sendRawTransaction', [
				uint8ToBase64(payload),
			])
			if (!result?.status)
				throw new Error(result?.error ?? 'transaksi ditolak node')
			setTxHashMapping(hashes.eth, hashes.nex)
			return hashes.eth
		}
		default:
			// JANGAN pernah fallback meneruskan method ke node: itu yang
			// membuka jalur nex_getWork/nex_submitWork ke publik.
			throw new Error(`method ${method} tidak tersedia di gateway`)
	}
}

const logRpc = (...parts: unknown[]): void =>
	console.log(`[${new Date().toISOString()}]`, ...parts)

const brief = (value: unknown): string => {
	let text: string
	try {
		text = JSON.stringify(value) ?? String(value)
	} catch {
		text = String(value)
	}
	return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

const handleRpcLogged = async (
	method: string,
	params: unknown,
): Promise<any> => {
	const started = Date.now()
	try {
		const result = await handleRpc(method, params)
		logRpc(
			method,
			brief(params),
			'→',
			brief(result),
			`(${Date.now() - started}ms)`,
		)
		return result
	} catch (error) {
		logRpc(
			method,
			brief(params),
			'→ ERROR',
			error instanceof Error ? error.message : String(error),
		)
		throw error
	}
}

app.get('/health', (_req, res) => {
	res.json({ service: 'nexchain-metamask-gateway', status: 'ok' })
})

app.get('/bridge/nonce', (_req, res) => {
	res.json({ nonce: issueNonce(), chainId: Number(CHAIN_ID_HEX) })
})

app.post('/bridge/register', (req, res) => {
	try {
		const { account, nonce, signature } = req.body ?? {}
		if (
			typeof account !== 'string' ||
			typeof nonce !== 'string' ||
			typeof signature !== 'string'
		) {
			res.status(400).json({ error: 'account, nonce, signature wajib' })
			return
		}
		const result = verifyRegistration(account, nonce, signature)
		// Nonce dipakai sekali, dan hanya setelah signature terverifikasi.
		if (!consumeNonce(nonce)) {
			res.status(400).json({ error: 'nonce tidak valid atau sudah dipakai' })
			return
		}
		setMapping(result.eth, result.nex)
		res.json({ status: 'ok', ...result })
	} catch (error) {
		res.status(400).json({
			error: error instanceof Error ? error.message : 'registrasi gagal',
		})
	}
})

app.post('/rpc', async (req, res) => {
	const body = req.body
	if (!body || typeof body !== 'object') {
		res.status(400).json({ error: 'request JSON-RPC tidak valid' })
		return
	}
	if (Array.isArray(body)) {
		const responses = await Promise.all(
			body.map(async (entry: any) => ({
				jsonrpc: '2.0',
				id: entry?.id ?? null,
				result: await handleRpcLogged(entry?.method, entry?.params),
			})),
		)
		res.json(responses)
		return
	}
	try {
		res.json({
			jsonrpc: '2.0',
			id: body.id ?? null,
			result: await handleRpcLogged(body.method, body.params),
		})
	} catch (error) {
		res.json({
			jsonrpc: '2.0',
			id: body.id ?? null,
			error: {
				code: -32601,
				message: error instanceof Error ? error.message : 'RPC error',
			},
		})
	}
})

const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
	if (res.headersSent) return _next(error)
	const status = (error as { status?: number }).status
	res.status(status === 413 ? 413 : 400).json({ error: 'request tidak valid' })
}
app.use(jsonErrorHandler)

app.get('/', (_req, res) => {
	res.type('html').send(onboardingPage)
})

app.listen(PORT, '127.0.0.1', () => {
	console.log(`MetaMask gateway listening on http://127.0.0.1:${PORT}`)
})

// ---------------------------------------------------------------------------
// Halaman onboarding — statis, tidak butuh build.
// ---------------------------------------------------------------------------

const onboardingPage = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>NexChain — Hubungkan MetaMask</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:38rem;margin:2rem auto;padding:0 1rem;color:#18202b}
h1{font-size:1.5rem} code{background:#eef2f6;padding:.15rem .35rem;border-radius:4px;word-break:break-all}
button{font-size:1rem;padding:.7rem 1rem;margin:.3rem .3rem .3rem 0;border:0;border-radius:8px;background:#2257d8;color:#fff}
.warn{background:#fff4d6;border-left:4px solid #d88a00;padding:.8rem 1rem;margin:1rem 0}
#status{margin-top:1rem;font-weight:600}
</style>
</head>
<body>
<h1>Hubungkan MetaMask ke NexChain</h1>
<p>Impor seed <b>tidak</b> memindahkan saldo. Saldo baru muncul setelah kamu tanda tangan gratis di bawah — <b>tanpa gas, tanpa transaksi, tanpa dana pindah</b>.</p>
<div class="warn">Alamat MetaMask (<code>0x…</code>) dan alamat NexChain (<code>NxC…</code>) memakai 20 byte yang sama — beda prefix saja. Tanda tangan ini mengikat 20 byte itu ke akun MetaMask. Salin alamat <code>NxC…</code> di bawah untuk menerima dana dari wallet NexChain.</div>
<button id="connect">Hubungkan &amp; daftarkan</button>
<button id="copyNex" hidden>Salin alamat NxC</button>
<pre id="status">Buka halaman ini dari ekstensi MetaMask di Chrome/Edge, atau tab Browser di MetaMask iOS.</pre>
<script>
const status = document.getElementById('status')
let registeredNex = ''
document.getElementById('copyNex').onclick = async () => {
  if (!registeredNex) return
  await navigator.clipboard.writeText(registeredNex)
  status.textContent = 'Alamat NxC tersalin:\\n' + registeredNex
}
const expectedChain = '${CHAIN_ID_HEX}'
const normalizeChainId = ${normalizeChainId.toString()}
const formatWeiAsNxc = ${formatWeiAsNxc.toString()}
const rpc = (method, params) => fetch('/rpc', {
  method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({jsonrpc:'2.0',id:1,method,params})
}).then(r => r.json())
document.getElementById('connect').onclick = async () => {
  try {
    if (!window.ethereum) throw new Error('window.ethereum tidak ada — pasang ekstensi MetaMask')
    const [account] = await window.ethereum.request({method:'eth_requestAccounts'})
    let chainId = normalizeChainId(await window.ethereum.request({method:'eth_chainId'}))
    if (chainId !== expectedChain) {
      try {
        await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:expectedChain}]})
      } catch (switchError) {
        if (switchError && switchError.code === 4902) {
          await window.ethereum.request({method:'wallet_addEthereumChain',params:[{
            chainId: expectedChain,
            rpcUrls: [location.origin + '/rpc'],
            nativeCurrency: {name:'NexChain', symbol:'NXC', decimals:18}
          }]})
        } else throw switchError
      }
      chainId = normalizeChainId(await window.ethereum.request({method:'eth_chainId'}))
    }
    if (chainId !== expectedChain) throw new Error('MetaMask melaporkan chainId '+String(chainId)+', harus '+expectedChain)
    const {nonce} = await fetch('/bridge/nonce').then(r => r.json())
    const message = ['NexChain wallet registration','chainId: ${Number(CHAIN_ID_HEX)}','nonce: '+nonce].join('\\n')
    const signature = await window.ethereum.request({method:'personal_sign',params:[message,account]})
    const result = await fetch('/bridge/register', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({account,nonce,signature})
    }).then(r => r.json())
    if (result.error) throw new Error(result.error)
    const balance = await rpc('eth_getBalance',[result.eth,'latest'])
    const saldo = balance.result ? formatWeiAsNxc(balance.result) : '?'
    registeredNex = result.nex
    document.getElementById('copyNex').hidden = false
    status.textContent = 'Terdaftar\\nMetaMask: '+result.eth+'\\nNexChain: '+result.nex+'\\nSaldo (NXC): '+saldo+'\\n\\nKalau saldo di MetaMask masih 0, pindah network ke Ethereum lalu balik ke NexChain untuk menyegarkan cache.\\nKirim dari MetaMask sudah aktif.'
  } catch (error) {
    status.textContent = 'Gagal: ' + (error.message || error)
  }
}
</script>
</body>
</html>`
