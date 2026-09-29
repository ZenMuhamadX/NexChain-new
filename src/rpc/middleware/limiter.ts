import { rateLimit } from 'express-rate-limit'
export const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 menit
	max: 10000, // Maksimal 10000 request per IP
	standardHeaders: true, // Menambahkan info rate limit di header Response
	legacyHeaders: false, // Menonaktifkan header X-RateLimit-* yang usang
	validate: { xForwardedForHeader: false },
})
