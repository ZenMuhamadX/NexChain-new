import { coinBaseTx } from './structCoinBaseTx'
import { header } from './structHeader'
import { metadata } from './structMetadata'
import { TxInterface } from './structTx'

export type HexString = `0x${string}`

/**
 * Struktur blok — standar PoW Bitcoin: blok TIDAK punya tanda tangan
 * (field `sign` dihapus). Keamanan blok berasal dari PoW + hash chain +
 * merkle + validasi penuh. Satu-satunya tanda tangan di rantai adalah
 * per-transaksi (`TxInterface.sign`, dibuat pengirim) dan — khusus genesis —
 * identitas jaringan ditentukan konstanta hash yang dikunci di kode
 * (`nexchain/block/genesis.ts`).
 */
export interface blockStruct {
	header: header
	height: number
	size: number
	totalTransactionFees: number // Optional field to store the total transaction fees in the block
	merkleRoot: string
	minerId: string
	chainId?: number
	status: 'confirmed' | 'pending'
	blockReward: number
	totalReward: number
	coinbaseTransaction: coinBaseTx
	metadata?: metadata
	transactions: TxInterface[]
}

/**
 * Ringkasan blok untuk list/pagination di explorer.
 * Ringkas supaya satu response banyak blok tidak membengkak.
 */
export interface blockSummary {
	height: number
	hash: string
	previousBlockHash: string
	timestamp: number
	minerId: string
	txCount: number
	size: number
	status: 'confirmed' | 'pending'
	difficulty: number
	blockReward: number
	totalReward: number
}