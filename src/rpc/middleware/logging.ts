import { NextFunction, Request, Response } from 'express'
import { loggingDebug } from 'src/logging/debug'

export const logRequest = (
	req: Request,
	_res: Response,
	next: NextFunction,
) => {
	const ip =
		(req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
		req.ip ||
		req.socket?.remoteAddress ||
		'-'
	const ua = req.headers['user-agent'] || '-'
	const rpcMethod = (req.body as any)?.method ?? '-'
	// Tiap request RPC (termasuk poll miner) — cukup di debug.
	loggingDebug(
		'rpc:middleware',
		`${ip} ${req.method} ${req.path} Rpc-Method:${rpcMethod} UA:${ua}`,
	)
	next()
}
