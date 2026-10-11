import { rpcRequest } from 'src/client/rpc-client/lib/rpcRequest'
import { decodeHexJson } from 'src/client/rpc-client/lib/decodeHexJson'
import { rpcGetAccount } from 'src/client/rpc-client/controller/rpcGetAccount'
import { rpcGetPendingBalance } from 'src/client/rpc-client/controller/rpcGetPendingBalance'
import { getNonce } from 'src/client/rpc-client/controller/rpcGetNonce'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import type { TxInterface } from 'src/types/transaction'
import type { structBalance } from 'src/types/balance'
import type { pendingBalance } from 'src/core/transaction/setPendingBalance'

/**
 * Pembungkus RPC untuk UI wallet.
 *
 * Semua pembacaan yang dikodekan hex-JSON lewat `decodeHexJson` (BUG-A) —
 * tanpa itu balance/nonce berupa string dan validasi client selalu gagal.
 * `nex_getMempool` / `nex_sendRawTransaction` mengembalikan JSON polos.
 *
 * Param tanpa-argumen memakai `''` karena `client.request` json-rpc-2.0
 * butuh dua argumen dan meneruskan params verbatim sebagai argumen tunggal.
 */

export const fetchAccount = (
	address: string,
): Promise<structBalance | undefined> => rpcGetAccount(address)

export const fetchPending = (
	address: string,
): Promise<pendingBalance | undefined> => rpcGetPendingBalance(address)

/** Nonce yang dibutuhkan transaksi berikutnya (`nex_getNextNonce`). */
export const fetchNextNonce = (address: string): Promise<number> =>
	getNonce(address)

export const fetchChainId = async (): Promise<number | undefined> =>
	decodeHexJson<number>(await rpcRequest('nex_getChainId', ''))

export const fetchMempool = async (): Promise<TxInterface[]> => {
	const raw = await rpcRequest('nex_getMempool', '')
	return Array.isArray(raw) ? (raw as TxInterface[]) : []
}

/**
 * Entry riwayat; `metadata` menyimpan asal blok bila tersedia
 * (cerminan `HistoryEntry` explorer — lokal agar tidak menarik runtime
 * explorer ke bundle).
 */
export interface HistoryEntry extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

export interface HistoryRow {
	tx: HistoryEntry
	/** true = masih di mempool (belum ada di `address:` index). */
	pending: boolean
}

/**
 * Riwayat gabungan: transaksi terkonfirmasi + mempool.
 *
 * `nex_getTransactionsByAddress` hanya membaca index `address:{addr}` yang
 * ditulis `saveTxByAddress` saat PROSES MINING — transaksi yang masih di
 * mempool TIDAK muncul di sana (saveTxHistory menulis kunci per-hash saja).
 * Tanpa penggabungan ini tab Riwayat wallet selalu kosong tepat setelah user
 * mengirim. Mempool difilter ke address yang relevan dan didedup per txHash
 * (konfirmasi menang bila sudah ada di keduanya).
 */
export const fetchHistory = async (address: string): Promise<HistoryRow[]> => {
	const raw = (await rpcRequest('nex_getTransactionsByAddress', address)) as
		{ count?: number; history?: (string | HistoryEntry)[] } | undefined

	const confirmed: HistoryEntry[] = []
	for (const item of raw?.history ?? []) {
		const entry =
			typeof item === 'string' ? decodeHexJson<HistoryEntry>(item) : item
		if (entry) confirmed.push(entry)
	}

	const seen = new Set<string>()
	for (const entry of confirmed) {
		if (typeof entry.txHash === 'string') seen.add(entry.txHash)
	}

	const mempool = await fetchMempool()
	const pending = mempool
		.filter((tx) => tx.sender === address || tx.receiver === address)
		.filter((tx) => typeof tx.txHash !== 'string' || !seen.has(tx.txHash))

	const rows: HistoryRow[] = [
		...confirmed.map((tx) => ({ tx, pending: false })),
		...pending.map((tx) => ({ tx, pending: true })),
	]
	// Urutkan menurut waktu BLOK. Transaksi masih tertunda belum punya blok,
	// jadi ia diletakkan paling atas (paling baru).
	const timeOf = (row: HistoryRow): number =>
		row.pending ? Number.MAX_SAFE_INTEGER : (row.tx.metadata?.blockTimestamp ?? 0)
	rows.sort((a, b) => timeOf(b) - timeOf(a))
	return rows
}

export interface SendRawResult {
	status: boolean
	txHash?: string
	error?: string
}

/** Kirim transaksi sudah tertandatangan (`nex_sendRawTransaction`, JSON polos). */
export const sendRawTransaction = async (
	signed: TxInterface,
): Promise<SendRawResult> => {
	const response = (await rpcRequest(
		'nex_sendRawTransaction',
		encodeTx(signed),
	)) as SendRawResult | undefined

	const result: SendRawResult = { status: response?.status === true }
	if (typeof response?.txHash === 'string') result.txHash = response.txHash
	if (typeof response?.error === 'string') result.error = response.error
	return result
}
