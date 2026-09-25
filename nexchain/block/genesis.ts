/** @format */

import { Block } from '../model/block/block'
import {
	INITIAL_DIFFICULTY_BITS,
	meetsDifficulty,
} from '../miner/difficulty'
import { toNexu } from '../nexucoin/toNexu'
import { stringToHex } from '../hex/stringToHex'
import { calculateSize } from '../lib/calculateSize'
import { hashWithNonce } from '../miner/Pow'
import { prepareBlockForHashing } from './prepareBlock'
import { CHAIN_ID } from 'sign/chainId'
import { logToConsole } from 'logging/logging'

/**
 * Genesis blok — standar Bitcoin: **hardcoded di kode**, bukan dibuat
 * node/wallet saat boot.
 *
 * Semua parameter deterministik dan tanpa wallet siapa pun:
 *   - coinbase dibayar ke **burned address** (`NxC` + 40×"0", tanpa private
 *     key) → reward genesis tidak dimiliki siapa pun di jaringan mana pun
 *     (termasuk devnet maupun clone — dana terkunci selamanya, seperti 50
 *     BTC genesis Bitcoin);
 *   - `GENESIS_NONCE` & `GENESIS_HASH` di-solve SEKALI saat implementasi
 *     dan dikunci sebagai konstanta (`bun run genesis:solve` lalu tempel);
 *   - `GENESIS_HASH` adalah identitas jaringan — node menolak rantai yang
 *     genesis hash-nya berbeda (anti-fork/tamper).
 *
 * Fork yang ingin jaringan sepenuhnya terpisah: ubah konstanta di bawah
 * (minimal `NEX_CHAIN_ID` di env, atau `GENESIS_TIMESTAMP`/`GENESIS_MESSAGE`
 * di kode), lalu re-solve nonce & hash (`bun run genesis:solve`). Saat boot,
 * `assertGenesisValid` menolak konstanta yang diubah tanpa re-solve.
 */

export const GENESIS_TIMESTAMP = 1727524800000 // 2024-09-28T12:00:00Z — tetap
export const GENESIS_VERSION = '1.0.0'
export const GENESIS_HASHING_ALGORITHM = 'SHA256'
export const GENESIS_PREVIOUS_BLOCK_HASH = '0'.repeat(64)
export const GENESIS_MERKLE_ROOT = '0'.repeat(64)
export const GENESIS_REWARD_NEX = 500
/** Alamat void — tidak ada private key, dana genesis tidak bisa di-spend. */
export const GENESIS_COINBASE_RECEIVER = `NxC${'0'.repeat(40)}`
export const GENESIS_COINBASE_MESSAGE = 'Genesis Block Reward'
export const GENESIS_MESSAGE = 'NexChain Devnet Genesis — Bitcoin-style PoW'

/**
 * Nonce & hash hasil solve (chain id 26). Jangan diubah tanpa re-solve.
 *
 * Di-re-solve saat rombak satuan 1e18 → 1e8: `prepareBlockForHashing`
 * memuat `blockReward`, dan `toNexu(GENESIS_REWARD_NEX)` kini menghasilkan
 * `50_000_000_000` nexu, bukan `500_000_000_000_000_000_000`.
 */
export const GENESIS_NONCE = 326395
export const GENESIS_HASH =
	'00000ba4319876896bf7dd4c0bf6ad685dfef6b64155e51cc3cd9131216e0a06'

/**
 * Susun blok genesis sesuai konstanta. Murni & deterministik — tidak
 * menulis ke DB. Header hash & size diisi; `nonce` dari `GENESIS_NONCE`.
 */
export const buildGenesisBlock = (): Block => {
	const timestamp = GENESIS_TIMESTAMP
	const reward = toNexu(GENESIS_REWARD_NEX)

	const block = new Block({
		header: {
			difficulty: INITIAL_DIFFICULTY_BITS,
			hash: GENESIS_HASH,
			nonce: GENESIS_NONCE,
			previousBlockHash: GENESIS_PREVIOUS_BLOCK_HASH,
			timestamp,
			version: GENESIS_VERSION,
			hashingAlgorithm: GENESIS_HASHING_ALGORITHM,
		},
		blockReward: reward,
		totalTransactionFees: 0,
		totalReward: reward,
		height: 0,
		merkleRoot: GENESIS_MERKLE_ROOT,
		minerId: GENESIS_COINBASE_RECEIVER,
		// chainId IKUT preimage PoW (prepareBlockForHashing) → jaringan dengan
		// NEX_CHAIN_ID berbeda = genesis berbeda = rantai terpisah penuh.
		chainId: CHAIN_ID,
		size: 0,
		status: 'confirmed',
		coinbaseTransaction: {
			amount: reward,
			receiver: GENESIS_COINBASE_RECEIVER,
			extraData: stringToHex(GENESIS_COINBASE_MESSAGE),
		},
		// Genesis memakai merkle sentinel 64×"0" (tanpa transaksi) — persis
		// pengecualian yang sudah dikenal `verifyIntegrity`.
		metadata: {
			gasPrice: 0,
			created_at: timestamp,
			txCount: 0,
			extraData: stringToHex(GENESIS_MESSAGE),
		},
		transactions: [],
	})
	block.block.size = calculateSize(block.block).KB
	return block
}

/**
 * Verifikasi konstanta genesis: SHA-256(preimage ‖ GENESIS_NONCE) harus
 * sama dengan `GENESIS_HASH` dan memenuhi difficulty. Gagal berarti
 * konstanta diubah (atau `NEX_CHAIN_ID` berbeda) tanpa re-solve — fork
 * harus menyelesaikan nonce sendiri via `bun run genesis:solve`.
 */
export const assertGenesisValid = (): void => {
	const block = buildGenesisBlock()
	const computed = hashWithNonce(
		prepareBlockForHashing(block),
		GENESIS_NONCE,
	)
	if (computed !== GENESIS_HASH) {
		throw new Error(
			`Genesis hash mismatch: computed ${computed}, konstanta ${GENESIS_HASH}. ` +
				'Nilai berubah tanpa re-solve (NEX_CHAIN_ID beda / konstanta diedit). ' +
				'Jalankan `bun run genesis:solve` lalu tempel GENESIS_NONCE & GENESIS_HASH.',
		)
	}
	if (!meetsDifficulty(computed, INITIAL_DIFFICULTY_BITS)) {
		throw new Error(
			`Genesis nonce tidak memenuhi difficulty ${INITIAL_DIFFICULTY_BITS} bits — re-solve.`,
		)
	}
}

/**
 * Genesis blok siap tulis, dengan jaminan konstanta valid.
 * Panggil SEKALI saat rantai kosong; untuk boot lengkap (termasuk
 * putAccount coinbase + saveBlock) lihat `rpc/server.ts`.
 */
export const getGenesisBlock = (): Block => {
	assertGenesisValid()
	const block = buildGenesisBlock()
	logToConsole(
		`Genesis block: hash ${GENESIS_HASH}, receiver ${GENESIS_COINBASE_RECEIVER} (burned — ${GENESIS_REWARD_NEX} NXC terkunci)`,
	)
	return block
}