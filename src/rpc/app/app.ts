import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { limiter } from 'src/rpc/middleware/limiter'
import { rpc } from 'src/rpc/method'
import { logRequest } from 'src/rpc/middleware/logging'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { normalizeJsonRpcRequest } from 'src/rpc/normalizeParams'

const app = express()

app.use(helmet())
app.use(
	cors({
		credentials: true,
		methods: 'POST',
		allowedHeaders: ['Content-Type'],
		origin: '*', // Mengizinkan semua domain untuk mengakses API
	}),
)
app.use(express.json({ limit: '10Mb' }))
app.use(limiter)
app.use(logRequest)

app.get('/', (_req, res) => {
	res.status(200).json({ rpc_status: 'OK' })
})

// Endpoint health check untuk load balancer / monitoring (uptime, cron, dll).
// Liveness: 200 selama server bisa merespons. Readiness: juga mengecek
// kondisi state blockchain (RocksDB) — kalau DB bermasalah respons 503
// supaya proxy/monitoring tahu node tidak siap menerima traffic.
app.get('/health', async (_req, res) => {
	const base = {
		service: 'nexchain-rpc',
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	}

	try {
		const state = await getBlockState()
		res.status(200).json({
			...base,
			status: 'ok',
			db: state ? 'connected' : 'empty',
			// Rantai belum punya genesis / state → blockchain null, tapi RPC
			// tetap hidup (genesis dibuat otomatis di boot oleh server.ts).
			blockchain: state
				? {
						currentBlockHeight: state.currentBlockHeight,
						currentBlockHash: state.currentBlockHash,
						lastUpdated: state.lastUpdated,
					}
				: null,
		})
	} catch (error) {
		res.status(503).json({
			...base,
			status: 'error',
			db: 'disconnected',
			error: error instanceof Error ? error.message : 'Unknown error',
		})
	}
})

// Route utama
app.post('/rpc', async (req, res): Promise<any> => {
	try {
		const jsonRPCRequest = req.body

		// Pastikan input JSON RPC sesuai spesifikasi (opsional)
		if (!jsonRPCRequest || typeof jsonRPCRequest !== 'object') {
			return res.status(400).json({
				ok: false,
				error: 'Invalid JSON-RPC request format',
				data: null,
			})
		}

		// Proses JSON-RPC request (params dinormalisasi lebih dulu supaya
		// format array/named-object JSON-RPC standar ikut diterima).
		const jsonRPCResponse = await rpc.receive(
			normalizeJsonRpcRequest(jsonRPCRequest),
		)
		if (jsonRPCResponse) {
			res.status(200).json(jsonRPCResponse)
		} else {
			// JSON-RPC notification (tanpa `id`): HARUS 204 No Content.
			// STAGE 1 FIX: sebelumnya 400, yang melanggar spesifikasi dan
			// membuat client compliant menganggap request gagal.
			res.status(204).end()
		}
	} catch (error) {
		console.error('Error handling RPC request:', error)
		// Menambahkan respons error yang lebih aman
		res.status(500).json('Internal server error')
	}
})

export { app }
