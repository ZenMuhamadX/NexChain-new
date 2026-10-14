/**
 * Middleware autentikasi method TULIS (`nex_sendTransaction`,
 * `nex_sendRawTransaction`, `nex_getWork`, `nex_submitWork`).
 *
 * Badan keputusannya ADA di `src/rpc/authLogic.ts` (murni, teruji offline
 * lewat `check:rpc`); file ini hanya penerjemah Express: baca body, header,
 * dan alamat remote lalu terapkan keputusannya. Sengaja tipis supaya tidak
 * ada logika keamanan yang hanya hidup di dalam middleware.
 *
 * Harus dipasang SETELAH `express.json` (butuh `req.body`) dan sebelum route.
 */
import type { NextFunction, Request, Response } from 'express'
import { evaluateRpcAuth, extractMethods } from 'src/rpc/authLogic'

/** Kode JSON-RPC informal untuk penolakan autentikasi / otorisasi. */
const AUTH_ERROR_CODE = -32001
const FORBIDDEN_ERROR_CODE = -32002

export const requireRpcAuth = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	const decision = evaluateRpcAuth(
		extractMethods(req.body),
		req.headers.authorization,
		// `req.socket.remoteAddress` — alamat KONEKSI asli, bukan
		// `x-forwarded-for` yang bisa ditulis sendiri oleh penyerang.
		req.socket?.remoteAddress ?? '',
		process.env.RPC_USER,
		process.env.RPC_PASSWORD,
	)

	if (decision.ok) {
		next()
		return
	}

	if (decision.challenge) {
		// Wajib untuk HTTP Basic: tanpa ini browser tidak pernah menawarkan
		// dialog kredensial dan client otomatis gagal diam-diam.
		res.setHeader('WWW-Authenticate', 'Basic realm="nexchain-rpc"')
	}
	res.status(decision.status).json({
		jsonrpc: '2.0',
		id: null,
		error: {
			code: decision.status === 401 ? AUTH_ERROR_CODE : FORBIDDEN_ERROR_CODE,
			message:
				decision.status === 401
					? 'autentikasi wajib untuk method tulis (HTTP Basic RPC_USER/RPC_PASSWORD)'
					: 'method tulis hanya boleh dari loopback selama RPC_USER/RPC_PASSWORD belum diset',
		},
	})
}
