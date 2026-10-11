import { JSONRPCServer } from 'json-rpc-2.0'
import { formatNxcWithUnit } from 'src/core/token/formatNxc'
import { getBlockByHash } from 'src/core/block/query/onChain/block/getBlockByHash'
import { getBlockByHeight } from 'src/core/block/query/onChain/block/getBlockByHeight'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { getCurrentBlock } from 'src/core/block/query/onChain/block/getCurrentBlock'
import { structBalance } from 'src/types/balance'
import { getHistoryByTxHash } from 'src/core/block/query/onChain/Transaction/getHistoryByTxHash'
import { getHistoryByAddress } from 'src/core/block/query/onChain/Transaction/getHistoryByAddress'
import { Block } from 'src/core/block/blockModel'
import { getAccount } from 'src/wallet/balance/getAccount'
import { addTxToMempool } from 'src/core/transaction/addTransactionToMempool'
import { TxInterface } from 'src/types/transaction'
import { decodeTx } from 'src/core/encoding/hex/tx/decodeTx'
import { getPendingBalance } from 'src/core/transaction/getPendingBalance'
import { createNewWalletAddress } from 'src/wallet/createNewWallet'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { loadMempool } from 'src/core/state/storage/mempool/loadMempool'
import { blockSummary } from 'src/types/block'
import { CHAIN_ID } from 'src/crypto/chainId'
import { getWork, submitWork } from 'src/core/consensus/work'

/** Ubah Block penuh menjadi ringkasan untuk list explorer. */
const toBlockSummary = (block: Block): blockSummary => {
	const b = block.block
	return {
		height: b.height,
		hash: b.header.hash,
		previousBlockHash: b.header.previousBlockHash,
		timestamp: b.header.timestamp,
		minerId: b.minerId,
		txCount: b.transactions?.length ?? 0,
		size: b.size,
		status: b.status,
		difficulty: b.header.difficulty,
		blockReward: b.blockReward,
		totalReward: b.totalReward,
	}
}

/**
 * Fetch kumpulan blok dari `from` (inklusif) ke bawah sebanyak `count`.
 * Height yang tidak ada / di bawah 0 dilewati diam-diam.
 */
const fetchBlockRange = async (
	from: number,
	count: number,
): Promise<blockSummary[]> => {
	const limit = Math.min(Math.max(Math.trunc(count) || 10, 1), 50)
	const start = Math.trunc(from)
	const heights = Array.from({ length: limit }, (_, i) => start - i).filter(
		(h) => h >= 0,
	)
	const blocks = await Promise.all(
		heights.map((h) => getBlockByHeight(h, 'json').catch(() => undefined)),
	)
	return blocks
		.filter((block): block is Block => block !== undefined && block !== null)
		.map(toBlockSummary)
}

// Normalisasi params: number | {count} | [count] | undefined → count
const parseCount = (params: unknown): number | undefined => {
	if (typeof params === 'number') return params
	if (Array.isArray(params))
		return typeof params[0] === 'number' ? params[0] : undefined
	if (params && typeof params === 'object') {
		const count = (params as Record<string, unknown>).count
		return typeof count === 'number' ? count : undefined
	}
	return undefined
}

// Normalisasi params range: {from,count} | [from,count] | number(from)
const parseRangeParams = (
	params: unknown,
): {
	from: number | undefined
	count: number | undefined
} => {
	const num = (value: unknown): number | undefined =>
		typeof value === 'number' && Number.isFinite(value) ? value : undefined
	if (typeof params === 'number') return { from: num(params), count: undefined }
	if (Array.isArray(params))
		return { from: num(params[0]), count: num(params[1]) }
	if (params && typeof params === 'object') {
		const record = params as Record<string, unknown>
		return { from: num(record.from), count: num(record.count) }
	}
	return { from: undefined, count: undefined }
}

const rpc = new JSONRPCServer()

rpc.addMethod('echo', (message: any) => {
	return message
})

// Block

rpc.addMethod('nex_getBlockByHash', async (hash: string): Promise<any> => {
	return await getBlockByHash(hash!, 'hex')
})

rpc.addMethod('nex_getBlockByHeight', async (blockNumber: number) => {
	return await getBlockByHeight(blockNumber!, 'hex')
})

rpc.addMethod('nex_getBlockTransactionByHeight', async (height: number) => {
	const block = (await getBlockByHeight(height, 'json')) as Block
	return block.block.transactions.length
})

rpc.addMethod('nex_getBlockTransactionByHash', async (hash: string) => {
	const block = (await getBlockByHash(hash, 'json')) as Block
	return block.block.transactions.length
})

rpc.addMethod('nex_getBlockState', async () => {
	return stringToHex(JSON.stringify(await getBlockState()))
})

rpc.addMethod('nex_getCurrentBlock', async () => {
	return await getCurrentBlock('hex')
})

rpc.addMethod('nex_getChainId', async () => {
	return CHAIN_ID
})

// Explorer: daftar blok terbaru (dihitung dari currentBlockHeight di state)
// Params: number(count) | {count} | [count] | kosong
// Return: blockSummary[] JSON polos (bukan hex)
rpc.addMethod('nex_getRecentBlocks', async (params?: unknown) => {
	const state = await getBlockState()
	if (!state) return []
	return await fetchBlockRange(
		state.currentBlockHeight,
		parseCount(params) ?? 10,
	)
})

// Explorer: pagination blok dari height `from` ke bawah
// Params: {from, count} | [from, count] | number(from)
// Return: blockSummary[] JSON polos (bukan hex)
rpc.addMethod('nex_getBlocksRange', async (params?: unknown) => {
	const { from, count } = parseRangeParams(params)
	if (from === undefined) return []
	return await fetchBlockRange(from, count ?? 10)
})

// Explorer: transaksi yang masih menunggu di mempool (maks 100)
// Return: TxInterface[] JSON polos (bukan hex)
rpc.addMethod('nex_getMempool', async () => {
	return await loadMempool()
})

// Account

rpc.addMethod('nex_getPendingBalance', async (address: string) => {
	return stringToHex(JSON.stringify(await getPendingBalance(address)))
})

rpc.addMethod('nex_getAccount', async (address: string) => {
	return stringToHex(JSON.stringify(await getAccount(address)))
})

rpc.addMethod('nex_getBalance', async (address: string) => {
	const account = await getAccount(address)
	// Presisi penuh, tanpa artefak floating point:
	// `toNxc(balance).toFixed(18)` sebelumnya membagi float lalu membulatkan
	// ke 18 digit — menghasilkan ekor seperti "100.00049999999901" untuk
	// saldo yang sebenarnya bulat. `formatNxcWithUnit` memotong string di
	// posisi titik desimal yang tepat.
	return stringToHex(formatNxcWithUnit(account?.balance!))
})

// Nonce akun (angka polos, agar mudah dipakai wallet client)
rpc.addMethod('nex_getNonceAccount', async (address: string) => {
	const account = await getAccount(address)
	return stringToHex(JSON.stringify(account?.nonce ?? 0))
})

/**
 * Nonce yang DIPERLUKAN transaksi berikutnya = nonce akun + jumlah transaksi
 * sender yang masih pending di mempool.
 *
 * Aturannya sama persis dengan `validateTransactionNonce`. Tanpa penambahan
 * jumlah pending ini, `nex_getNonceAccount` hanya memberi nonce blok yang
 * sudah dikonfirmasi, sehingga transaksi ke-2 dari akun yang sama SELALU
 * ditolak node ("expected 1, got 0") sampai blok berikutnya ter-mining.
 *
 * Dihitung di server supaya wallet tidak perlu mengunduh seluruh mempool
 * hanya untuk menghitung transaksinya sendiri.
 */
rpc.addMethod('nex_getNextNonce', async (address: string) => {
	const account = await getAccount(address)
	const mempool = await loadMempool().catch(() => [])
	const pendingCount = Array.isArray(mempool)
		? mempool.filter((tx: TxInterface) => tx.from === address).length
		: 0
	return stringToHex(JSON.stringify((account?.nonce ?? 0) + pendingCount))
})

// Transaction

rpc.addMethod('nex_getTransactionCount', async (address: string) => {
	const account = (await getAccount(address)) as structBalance
	return stringToHex(JSON.stringify(account?.transactionCount))
})

rpc.addMethod('nex_getTransactionByTxHash', async (txHash: string) => {
	return await getHistoryByTxHash(txHash, 'hex')
})

rpc.addMethod('nex_getTransactionsByAddress', async (address: string) => {
	return await getHistoryByAddress(address, 'hex')
})

rpc.addMethod('nex_sendTransaction', async (data: string) => {
	const decodedData: TxInterface = decodeTx(data)
	return await addTxToMempool(decodedData)
})

// Kirim transaksi yang SUDAH di-sign di client (browser wallet).
// Node tidak memegang private key — hanya memvalidasi signature & memasukkan ke mempool.
// Return: { status, txHash, error? }
rpc.addMethod('nex_sendRawTransaction', async (data: string) => {
	try {
		if (typeof data !== 'string' || data.length === 0) {
			return { status: false, error: 'Invalid raw transaction data' }
		}
		const decodedData: TxInterface = decodeTx(data)

		// Pastikan field wajib ada sebelum validasi signature
		if (!decodedData.txHash || !decodedData.sign) {
			return { status: false, error: 'Transaction is not signed' }
		}

		const result = await addTxToMempool(decodedData)
		return {
			status: result,
			txHash: decodedData.txHash,
			error: result ? undefined : 'Transaction rejected by mempool',
		}
	} catch (error) {
		return {
			status: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
	}
})

rpc.addMethod('nex_createWallet', async () => {
	return JSON.stringify(await createNewWalletAddress())
})

// Mining (job eksternal) — node menyusun template + difficulty adaptif
// target 30 detik; miner eksternal yang menghitung PoW lewat HTTP sehingga
// RPC tetap hidup selama mining. Lihat nexchain/miner/work.ts.
// Params getWork: {minerAddress} | [minerAddress] | minerAddress | kosong
//   → {status, jobId, payload, difficulty, height, previousBlockHash, ...}
// Params submitWork: {jobId, nonce, hash} → {status, height?, hash?, error?}
rpc.addMethod('nex_getWork', async (params?: unknown) => {
	return await getWork(params)
})

rpc.addMethod('nex_submitWork', async (params?: unknown) => {
	return await submitWork(params)
})

export { rpc }
