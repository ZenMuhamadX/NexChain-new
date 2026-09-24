import { NextFunction, Request, Response } from 'express'
import { logToConsole } from 'logging/logging'

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
	logToConsole(`${ip} ${req.method} ${req.path} Rpc-Method:${rpcMethod} UA:${ua}`)
	next()
}
