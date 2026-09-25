/** @format */
import { blockStruct } from '../../../interface/structBlock'
import { CHAIN_ID } from 'sign/chainId'

// models/Block.ts
// This class represents a block in the blockchain
export class Block {
	public block: blockStruct
	constructor(blockData: blockStruct) {
		this.block = {
			header: {
				previousBlockHash: blockData.header.previousBlockHash,
				timestamp: blockData.header.timestamp,
				hash: blockData.header.hash,
				nonce: blockData.header.nonce!, // Use empty string if nonce is undefined
				version: blockData.header.version,
				// BUG (diperbaiki): sebelumnya `difficulty: 5` di-hardcode —
				// nilai difficulty sebenarnya dari template/retarget selalu
				// terbuang, sehingga verifikasi PoW dan produksi blok tidak
				// pernah memakai angka yang sama.
				difficulty: blockData.header.difficulty,
				hashingAlgorithm: blockData.header.hashingAlgorithm,
			},
			height: blockData.height,
			size: blockData.size,
			merkleRoot: blockData.merkleRoot,
			minerId: blockData.minerId,
			chainId: blockData.chainId ?? CHAIN_ID,
			blockReward: blockData.blockReward,
			totalReward: blockData.totalReward,
			status: blockData.status,
			totalTransactionFees: blockData.totalTransactionFees!,
			coinbaseTransaction: blockData.coinbaseTransaction,
			metadata: blockData.metadata!,
			transactions: blockData.transactions,
		}
	}
}
