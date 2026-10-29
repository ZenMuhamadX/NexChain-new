/**
 * Tipe data explorer — CERMIN KONTRAK WIRE `POST /rpc`, bukan struct
 * internal node.
 *
 * Sebelumnya file ini meng-`import type` dari `src/types/*`. Itu membuat
 * explorer ikut berubah (atau gagal typecheck) setiap kali struct internal
 * node dirombak, padahal yang dilihat explorer hanyalah JSON hasil RPC.
 * Sejak v0.1 struct internal sudah berbeda dari payload RPC di beberapa
 * tempat (leaf akun RLP, `header.stateRoot`, `blockState.totalIssued`),
 * jadi kontraknya dimodelkan ulang di sini.
 *
 * Aturan pemeliharaan:
 *   - field yang WAJIB ada di payload → wajib di sini;
 *   - field baru yang belum tentu ada di node lama → `optional`, dirender
 *     hanya bila terisi (jangan pernah mengarang nilai default yang terlihat
 *     seperti data on-chain);
 *   - field yang sudah DIHAPUS dari protokol (mis. `isContract`) tidak
 *     dipakai UI sama sekali — kalau masih dikirim node lama, diabaikan.
 */

export type HexString = `0x${string}`

/** Header blok. `timestamp` = epoch ms; `difficulty` = float (0.25 bit). */
export interface BlockHeader {
	previousBlockHash: string
	timestamp: number
	hash: string
	nonce: number
	version: string
	difficulty: number
	hashingAlgorithm: string
	/**
	 * v0.1: komitmen state (akumulator chained-diff, bukan trie).
	 * Opsional supaya explorer tetap jalan di node pra-v0.1.
	 */
	stateRoot?: string
}

/** Hadiah blok. `amount` = blockReward + Σ fee = `totalReward`. */
export interface CoinbaseTransaction {
	receiver: string
	amount: number
	extraData?: HexString
}

/** Metadata blok. `txCount` = jumlah transaksi PENGGUNA (coinbase tidak ikut). */
export interface BlockMetadata {
	txCount: number
	created_at: number
	extraData: HexString
}

/**
 * Transaksi on-chain. `from` dan `txHash` adalah field TURUNAN (ecrecover /
 * sha256 payload) — selalu ada pada transaksi yang sudah di-decode, tapi
 * opsional di tipe karena draft belum memilikinya.
 *
 * `txHash` berbentuk `TxC` + 64 hex = 67 karakter, BUKAN 64 hex.
 */
export interface TxInterface {
	nonce: number
	fee: number
	receiver: string
	amount: number
	data?: HexString
	sign: {
		v: number
		r: string
		s: string
	}
	from?: string
	txHash?: string
}

/**
 * Blok penuh — respons dibungkus `{ block: ... }`.
 *
 * `size` = Σ byte wire transaksi PENGGUNA (genesis = 0; coinbase tidak
 * dihitung). `transactions` juga tidak memuat coinbase: hadiah blok hidup
 * di `coinbaseTransaction`.
 */
export interface blockStruct {
	header: BlockHeader
	height: number
	size: number
	totalTransactionFees: number
	merkleRoot: string
	minerId: string
	chainId?: number
	status: 'confirmed' | 'pending'
	blockReward: number
	totalReward: number
	coinbaseTransaction: CoinbaseTransaction
	metadata?: BlockMetadata
	transactions: TxInterface[]
}

/** Ringkasan blok untuk list/pagination (`nex_getRecentBlocks`, `nex_getBlocksRange`). */
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

/**
 * Akun dari `nex_getAccount`.
 *
 * `balance` dalam nexu (bilangan bulat). `lastTransactionDate` = timestamp
 * BLOK (epoch ms) atau null. `transactionCount` naik saat kirim DAN terima
 * (self-send +2), jadi BUKAN jumlah entri riwayat.
 *
 * `isContract` hanya dikirim node lama — protokol v0.1 tidak punya kontrak.
 * Jangan pernah dipakai untuk keputusan UI.
 */
export interface structBalance {
	address: string
	balance: number
	transactionCount: number
	lastTransactionDate: number | null
	nonce: number
	/** @deprecated legacy pra-v0.1; selalu false bila ada. */
	isContract?: boolean
}

/** Pointer tip dari `nex_getBlockState`. */
export interface BlockState {
	currentBlockHeight: number
	prevBlockHash: string
	currentBlockHash: string
	currentTimestamp: number
	blockReward: number
	/** Jam dinding node — NON-DETERMINISTIK, jangan dipakai sebagai waktu blok. */
	lastUpdated: number
	currentBlockSize: number
	/**
	 * v0.1: Σ `blockReward` sejak genesis (dasar plafon 50 juta NXC).
	 * Opsional supaya explorer tetap jalan di node pra-v0.1.
	 */
	totalIssued?: number
}

/** Serialisasi kelas backend `Block` → `{ block: ... }`. */
export interface BlockResponse {
	block: blockStruct
}

export interface PendingReserve {
	address?: string
	pendingAmount?: number
}

/**
 * Entri riwayat = transaksi + metadata blok.
 *
 * Keberadaan `metadata.blockHeight` berarti transaksi SUDAH dieksekusi —
 * itulah pengganti flag `status` yang mutable.
 */
export interface HistoryEntry extends TxInterface {
	metadata?: {
		blockHeight: number
		blockHash: string
		blockTimestamp: number
		merkleRoot: string
	}
}

/** Respons `nex_getTransactionsByAddress`. */
export interface TransactionHistory {
	count?: number
	history?: HistoryEntry[]
}

/* ---- payload JSON-RPC ---- */

export interface JsonRpcErrorPayload {
	code: number
	message: string
	data?: unknown
}

export interface JsonRpcResponse<T> {
	jsonrpc: '2.0'
	id: number
	result?: T
	error?: JsonRpcErrorPayload
}
