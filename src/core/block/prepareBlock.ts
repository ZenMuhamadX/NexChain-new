import { Block } from 'src/core/block/blockModel'

export const prepareBlockForHashing = ({ block }: Block): string => {
	const newBlockStruct = {
		previousBlockHash: block.header.previousBlockHash,
		timestamp: block.header.timestamp,
		version: block.header.version,
		hashingAlgorithm: block.header.hashingAlgorithm,
		height: block.height,
		merkleRoot: block.merkleRoot,
		chainId: block.chainId,
		status: block.status,
		blockReward: block.blockReward,
		// ------------------------------------------------------------------
		// HADIAH BLOK DIKOMIT DI SINI.
		//
		// Sebelumnya ketiga nilai ini hanya ter-commit secara INSIDENTAL:
		// pseudo-tx coinbase dimasukkan ke `transactions`, dan `transactions`
		// ikut di-hash. Begitu coinbase dikeluarkan dari daftar transaksi
		// (hadiah jadi logika protokol), komitmennya harus dibuat EKSPLISIT —
		// kalau tidak, penambang bisa mengalihkan hadiah ke alamat lain tanpa
		// mengulang PoW.
		//
		// `totalReward` wajib ada meski `blockReward` sudah ikut: selisihnya
		// (`gasPrice + Σ fee`) tidak bisa diturunkan dari preimage, karena
		// `gasPrice` tinggal di `metadata` yang tidak di-hash.
		// ------------------------------------------------------------------
		minerId: block.minerId,
		totalReward: block.totalReward,
		coinbaseTransaction: block.coinbaseTransaction,
		transactions: block.transactions,
	}
	return JSON.stringify(newBlockStruct)
}
