/** @format */

import { Block } from 'src/core/block/blockModel'
import { emit } from './fileSink'

/**
 * Cek flag --debug dengan aman (process tidak ada di browser).
 */
const hasDebugFlag = (): boolean =>
	typeof process !== 'undefined' &&
	Array.isArray(process.argv) &&
	process.argv.includes('--debug')

// Function to log mining status: satu baris ke konsol (info), dump blok
// hanya ke berkas (debug) supaya konsol tidak kebanjiran.
export const mineLog = (status: Block): void => {
	try {
		emit('info', `Block ${status.block.header.hash} Created Succesfully`)
		emit('debug', JSON.stringify(status.block), {
			namespace: 'mining',
			toConsole: hasDebugFlag(),
		})
	} catch (error) {
		console.error('Error saving mining log:', error)
	}
}
