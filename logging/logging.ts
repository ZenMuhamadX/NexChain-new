/** @format */

import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import chalk from 'chalk'

/**
 * Cek flag --debug dengan aman (process tidak ada di browser).
 */
const hasDebugFlag = (): boolean =>
	typeof process !== 'undefined' &&
	Array.isArray(process.argv) &&
	process.argv.includes('--debug')

export const logToConsole = (message: string) => {
	const thisTimestamp = generateTimestampz()
	const date = new Date(thisTimestamp).toISOString()

	if (hasDebugFlag()) {
		return
	}

	console.info(
		`(${chalk.green('info')}) [${chalk.yellowBright(date)}]: ${chalk.cyan(message)}`,
	)
}
