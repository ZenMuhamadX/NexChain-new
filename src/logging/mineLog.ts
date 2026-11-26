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

// Function to log mining status: satu baris ringkas (info), dump blok
// terbaca (debug) tetap masuk berkas supaya detail tidak hilang.
export const mineLog = (status: Block): void => {
	try {
		emit(
			'info',
			`Block ${status.block.header.hash} created successfully — ` +
				`height ${status.block.height}, ` +
				`${status.block.transactions.length} tx, ` +
				`${status.block.header.difficulty} bits`,
		)
		emit('debug', JSON.stringify(status.block, null, 2), {
			namespace: 'mining',
			toConsole: hasDebugFlag(),
		})
	} catch (error) {
		console.error('Error saving mining log:', error)
	}
}
