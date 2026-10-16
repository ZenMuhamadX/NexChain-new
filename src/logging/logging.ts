/** @format */

import { emit } from './fileSink'

export const logToConsole = (message: string) => {
	emit('info', message)
}
