import { rocksMempool } from 'src/core/state/db/memPool'

export const removeMemPool = (txHash: string) => {
	try {
		rocksMempool.del(`0x${txHash}`, {
			sync: true,
		})
	} catch (error) {
		console.error('Error removing transaction:', error)
	}
}
