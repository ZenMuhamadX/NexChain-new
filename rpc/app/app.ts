import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { limiter } from 'rpc/middleware/limiter'
import { rpc } from 'rpc/method'
import { logRequest } from 'rpc/middleware/logging'
import { getBlockState } from 'nexchain/storage/state/getState'

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

		// Proses JSON-RPC request
		const jsonRPCResponse = await rpc.receive(jsonRPCRequest)
		if (jsonRPCResponse) {
			res.status(200).json(jsonRPCResponse)
		} else {
			// Jika JSON-RPC notification, respons tanpa konten (204)
			res.status(400).json('Invalid JSON-RPC request method')
		}
	} catch (error) {
		console.error('Error handling RPC request:', error)
		// Menambahkan respons error yang lebih aman
		res.status(500).json('Internal server error')
	}
})

export { app }
