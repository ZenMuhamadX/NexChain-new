import express, { ErrorRequestHandler } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { limiter } from 'src/rpc/middleware/limiter'
import { rpc } from 'src/rpc/method'
import { logRequest } from 'src/rpc/middleware/logging'
import { requireRpcAuth } from 'src/rpc/middleware/auth'
import { parseCorsOrigins, isOriginAllowed } from 'src/rpc/corsOrigins'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { normalizeJsonRpcRequest } from 'src/rpc/normalizeParams'

const app = express()

// Allowlist origin (env RPC_CORS_ORIGINS, default = port UI dev + "null"
// untuk shell Electron yang dimuat dari file://). Lihat src/rpc/corsOrigins.ts.
const allowedOrigins = parseCorsOrigins(process.env.RPC_CORS_ORIGINS)

/**
 * Jumlah maksimum entri dalam SATU request batch JSON-RPC.
 * Rationale lengkap ada di route `POST /rpc` di bawah — konstanta ditaruh di
 * sini supaya angkanya mudah ditemukan saat review.
 */
const MAX_BATCH = 20

app.use(helmet())
// CORS allowlist — BUKAN '*' lagi:
//   - `Authorization` ikut di `allowedHeaders` supaya preflight method tulis
//     (yang membawa Basic Auth) tidak ditolak browser;
//   - TANPA `credentials`: autentikasi memakai header Authorization, bukan
//     cookie, sehingga `Access-Control-Allow-Credentials` tidak diperlukan.
app.use(
	cors({
		methods: 'POST',
		allowedHeaders: ['Content-Type', 'Authorization'],
		origin: (origin, callback) =>
			callback(null, isOriginAllowed(origin, allowedOrigins)),
	}),
)

// URUTAN PENTING: rate limit SEBELUM body parsing.
//
// Dulu `express.json({ limit: '10Mb' })` berjalan lebih dulu, sehingga
// biaya parse 10MB terjadi SEBELUM limiter sempat menghitung — penyerang
// bisa memboroskan CPU/memori node tanpa terkena limit. Kini limiter
// menghitung dulu, lalu body dibatasi 256KB (transaksi signed beberapa
// ratus byte; batch dibatasi 20 entri di route), sehingga dua lapis proteksi
// ini saling menutup: request berlebih ditolak murah, request yang lolos
// tetap kecil.
app.use(limiter)
app.use(express.json({ limit: '256kb' }))
app.use(logRequest)
// Autentikasi method tulis — sesudah body terparse (butuh method JSON-RPC
// yang ada di dalam body), sebelum route yang mengeksekusinya.
app.use(requireRpcAuth)

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

		// BATAS BATCH — sebelum `rpc.receive`.
		//
		// `json-rpc-2.0` mengeksekusi entri batch lewat `Promise.all`, jadi
		// satu request HTTP bisa memicu puluhan eksekusi paralel. Rate limit
		// di atas menghitung request HTTP, BUKAN pemanggilan method RPC —
		// tanpa batas ini satu koneksi bisa membanjiri node dengan ribuan
		// method tulis/baca sekaligus.
		if (Array.isArray(jsonRPCRequest) && jsonRPCRequest.length > MAX_BATCH) {
			return res.status(400).json({
				jsonrpc: '2.0',
				id: null,
				error: {
					code: -32600,
					message: `batch terlalu besar (maks ${MAX_BATCH})`,
				},
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

// Error handler JSON — HARUS dipasang SETELAH semua route.
//
// Tanpa ini, error dari `express.json` (body > 256KB / JSON rusak) dijawab
// Express dengan halaman HTML default — sementara SEMUA klien RPC (wallet,
// miner, explorer, curl) mengharapkan JSON dan tidak bisa membaca HTML.
const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
	if (res.headersSent) {
		_next(error)
		return
	}
	const err = error as {
		type?: string
		status?: number
		statusCode?: number
	}
	const bodyStatus = err.status ?? err.statusCode

	let status = 500
	let code = -32603
	let message = 'internal server error'
	if (err.type === 'entity.too.large') {
		// Payload memang sengaja dibatasi 256kb — ini penolakan yang benar,
		// bukan kegagalan: beri tahu klien lewat JSON + 413.
		status = 413
		code = -32600
		message = 'body terlalu besar (maks 256kb)'
	} else if (err.type === 'entity.parse.failed') {
		status = 400
		code = -32700
		message = 'JSON tidak valid'
	} else if (
		typeof bodyStatus === 'number' &&
		bodyStatus >= 400 &&
		bodyStatus < 500
	) {
		// Error body-parser lain (encoding tak didukung, dsb.) — tetap 4xx
		// dengan pesan generik tanpa membocorkan detail internal.
		status = bodyStatus
		code = -32600
		message = 'body request tidak valid'
	} else {
		console.error('RPC body error:', error)
	}
	res.status(status).json({
		jsonrpc: '2.0',
		id: null,
		error: { code, message },
	})
}
app.use(jsonErrorHandler)

export { app }
