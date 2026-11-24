/**
 * Gateway MetaMask — proses TERPILAH dari node.
 *
 * Node tetap memakai Basic Auth + CORS ketat di loopback. Gateway ini yang
 * bicara `eth_*` ke MetaMask (CORS longgar, tanpa credentials) dan meneruskan
 * HANYA method baca ke node lewat `nex_*`.
 */
import { config } from 'dotenv'
import express, { ErrorRequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import {
	CHAIN_ID_HEX,
	consumeNonce,
	GAS_PRICE_HEX,
	getNexForEth,
	issueNonce,
	nexToEthAddress,
	nodeRpc,
	nexuToWeiHex,
	setMapping,
	toEthHash,
	toHexQuantity,
	toNexHash,
	verifyRegistration,
} from './bridge'

config({ path: `${process.cwd()}/.env` })

const PORT = Number(process.env.METAMASK_GATEWAY_PORT ?? 8545)
const GAS_LIMIT_HEX = '0x5208' // 21000 — prototype, belum ada EVM

const app = express()
app.disable('x-powered-by')
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

const toEthTx = (record: any): EthTx => {
	const meta = record.metadata as
		{ blockHeight: number; blockHash: string } | undefined
	const sign = record.sign as { v: number; r: string; s: string } | undefined
	const prefix32 = (value: string): string =>
		`0x${value.replace(/^0x/, '').padStart(64, '0')}`
	return {
		hash: toEthHash(record.txHash),
		nonce: toHexQuantity(record.nonce),
		blockHash: meta ? `0x${meta.blockHash}` : null,
		blockNumber: meta ? toHexQuantity(meta.blockHeight) : null,
		transactionIndex: meta ? '0x0' : null,
		from: nexToEthAddress(record.from),
		to: nexToEthAddress(record.receiver),
		value: nexuToWeiHex(record.amount),
		gas: GAS_LIMIT_HEX,
		gasPrice: GAS_PRICE_HEX,
		input: typeof record.data === 'string' ? record.data : '0x',
		v: sign ? toHexQuantity(sign.v) : '0x0',
		r: sign ? prefix32(sign.r) : prefix32('0'),
		s: sign ? prefix32(sign.s) : prefix32('0'),
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
			const nex = getNexForEth(asString(params, 0))
			if (!nex) return '0x0' // belum registrasi → alamat NexChain tidak dikenal
			const account = await nodeRpc('nex_getAccount', [nex])
			return nexuToWeiHex(account?.balance ?? 0)
		}
		case 'eth_getTransactionCount': {
			const nex = getNexForEth(asString(params, 0))
			if (!nex) return '0x0'
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
			if (!block) return null
			const body = (block as any).block ?? block
			return {
				number: toHexQuantity(body.height),
				hash: `0x${body.header.hash}`,
				parentHash: `0x${body.header.previousBlockHash}`,
				timestamp: toHexQuantity(body.header.timestamp),
				miner: nexToEthAddress(body.minerId),
				gasLimit: GAS_LIMIT_HEX,
				gasUsed: '0x0',
				transactions: (body.transactions ?? []).map((tx: any) =>
					param(params, 1) === true ? toEthTx(tx) : toEthHash(tx.txHash),
				),
			}
		}
		case 'eth_getTransactionByHash': {
			const hash = asString(params, 0)
			try {
				const record = await nodeRpc('nex_getTransactionByTxHash', [
					toNexHash(hash),
				])
				return record ? toEthTx(record) : null
			} catch {
				return null
			}
		}
		case 'eth_getTransactionReceipt': {
			const hash = asString(params, 0)
			try {
				const record = await nodeRpc('nex_getTransactionByTxHash', [
					toNexHash(hash),
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
			} catch {
				return null
			}
		}
		default:
			// JANGAN pernah fallback meneruskan method ke node: itu yang
			// membuka jalur nex_getWork/nex_submitWork ke publik.
			throw new Error(`method ${method} tidak tersedia di gateway`)
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
				result: await handleRpc(entry?.method, entry?.params),
			})),
		)
		res.json(responses)
		return
	}
	try {
		res.json({
			jsonrpc: '2.0',
			id: body.id ?? null,
			result: await handleRpc(body.method, body.params),
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
<div class="warn">Alamat MetaMask (<code>0x…</code>) berbeda dengan alamat wallet NexChain lama (<code>NxC…</code>), walaupun seed-nya sama. Tanda tangan ini memberi tahu gateway mana alamat NexChain milik akun MetaMask ini.</div>
<button id="connect">Hubungkan &amp; daftarkan</button>
<pre id="status">Buka halaman ini dari tab Browser di dalam aplikasi MetaMask iOS.</pre>
<script>
const status = document.getElementById('status')
const rpc = (method, params) => fetch('/rpc', {
  method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({jsonrpc:'2.0',id:1,method,params})
}).then(r => r.json())
document.getElementById('connect').onclick = async () => {
  try {
    if (!window.ethereum) throw new Error('window.ethereum tidak ada — buka dari MetaMask Browser')
    const [account] = await window.ethereum.request({method:'eth_requestAccounts'})
    const chainId = await window.ethereum.request({method:'eth_chainId'})
    if (chainId !== '${CHAIN_ID_HEX}') throw new Error('Pindah ke jaringan NexChain (chainId ${CHAIN_ID_HEX}) dulu')
    const {nonce} = await fetch('/bridge/nonce').then(r => r.json())
    const message = ['NexChain wallet registration','chainId: ${Number(CHAIN_ID_HEX)}','nonce: '+nonce].join('\\n')
    const signature = await window.ethereum.request({method:'personal_sign',params:[message,account]})
    const result = await fetch('/bridge/register', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({account,nonce,signature})
    }).then(r => r.json())
    if (result.error) throw new Error(result.error)
    const balance = await rpc('eth_getBalance',[account,'latest'])
    status.textContent = 'Terdaftar\\nMetaMask: '+result.eth+'\\nNexChain: '+result.nex+'\\nSaldo (wei): '+balance.result+'\\n\\nKirim transaksi belum aktif di tahap ini.'
  } catch (error) {
    status.textContent = 'Gagal: ' + (error.message || error)
  }
}
</script>
</body>
</html>`
