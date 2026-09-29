import { loggingErr } from 'src/logging/errorLog'
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'

export const logError = (
	context: string,
	hint: string,
	error: any,
): boolean => {
	loggingErr({
		context,
		hint,
		level: 'error',
		message: error,
		priority: 'high',
		timestamp: generateTimestampz(),
		stack: new Error().stack!,
	})
	return false
}
