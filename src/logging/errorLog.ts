import { emit } from './fileSink'

// Define ErrorInfo interface
interface ErrorInfo {
	timestamp: number
	level: 'error'
	message: string
	context: string
	stack: string
	priority: 'low' | 'high'
	hint?: string
}

// Function to log errors. Sign-nya TETAP sync agar tidak mengubah caller.
export const loggingErr = (err: ErrorInfo): void => {
	if (!err) return

	// Konteks + stack ikut ke berkas; konsol hanya untuk prioritas tinggi.
	const parts = [`[${err.context}] ${err.message}`]
	if (err.hint) parts.push(`petunjuk: ${err.hint}`)
	if (err.stack) parts.push(err.stack)
	emit('error', parts.join('\n'), {
		namespace: err.context,
		toConsole: err.priority === 'high',
	})
}
