/** @format */

import { Block } from 'src/core/block/blockModel'
import {
	INITIAL_DIFFICULTY_BITS,
	meetsDifficulty,
} from 'src/core/consensus/difficulty'
import { toNexu } from 'src/core/token/toNexu'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { hashWithNonce } from 'src/core/consensus/Pow'
import { prepareBlockForHashing } from './prepareBlock'
import { CHAIN_ID } from 'src/crypto/chainId'
import { logToConsole } from 'src/logging/logging'

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
/**
 * Hadiah genesis — **0 sejak P2**, dibayar ke alamat burn tanpa private key.
 *
 * Awalnya 500 NXC, tetapi jadwal halving baru (Σ = 49_999_999.78 NXC) +
 * genesis 500 NXC = 50_000_499.78 NXC MELEBIHI plafon 50 juta NXC.
 * Karena alamatnya burn (nilai ekonomi nol), solusi paling bersih adalah
 * nol-kan hadiahnya — tanpa mengubah R0/H jadwal dan tanpa menyentuh
 * plafon. Konsekuensi: preimage genesis berubah → GENESIS_NONCE/HASH
 * di-re-solve (`bun run genesis:solve`).
 */
export const GENESIS_REWARD_NEX = 0
/** Alamat void — tidak ada private key, dana genesis tidak bisa di-spend. */
export const GENESIS_COINBASE_RECEIVER = `NxC${'0'.repeat(40)}`
export const GENESIS_COINBASE_MESSAGE = 'Genesis Block Reward'
export const GENESIS_MESSAGE = 'NexChain Devnet Genesis — Bitcoin-style PoW'

/**
 * Nonce & hash hasil solve (chain id 26). Jangan diubah tanpa re-solve.
 *
 * Riwayat re-solve:
 *   - rombak satuan 1e18 → 1e8: `prepareBlockForHashing` memuat `blockReward`,
 *     dan `toNexu(GENESIS_REWARD_NEX)` berubah nilainya.
 *   - coinbase dikeluarkan dari daftar transaksi: preimage kini juga memuat
 *     `minerId`, `totalReward`, dan `coinbaseTransaction`.
 *   - P2 jadwal halving + penghapusan gasPrice: `GENESIS_REWARD_NEX`
 *     500 → 0 (Σ jadwal + genesis 500 akan melampaui plafon 50 juta NXC);
 *     `blockReward`/`totalReward`/`coinbaseTransaction.amount` ikut preimage,
 *     jadi nonce & hash di-re-solve.
 *   - M0 difficulty: `difficulty` kini IKUT preimage PoW (sebelumnya di luar),
 *     sehingga preimage genesis berubah → nonce & hash di-re-solve.
 */
export const GENESIS_NONCE = 1219569
export const GENESIS_HASH =
	'00000f7117e28ab1237b19406c6ad9dc120f3597c25436409d1c6f227e4e0b09'

/**
 * Susun blok genesis sesuai konstanta. Murni & deterministik — tidak
 * menulis ke DB. Header hash diisi; `nonce` dari `GENESIS_NONCE`. `size`
 * = Σ byte wire tx = 0 (genesis tidak punya transaksi pengguna).
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
		// (Field `gasPrice` dihapus dari metadata pada P2 — metadata genesis
		// mengikuti schema yang sama dengan blok biasa.)
		metadata: {
			created_at: timestamp,
			txCount: 0,
			extraData: stringToHex(GENESIS_MESSAGE),
		},
		transactions: [],
	})
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
	const computed = hashWithNonce(prepareBlockForHashing(block), GENESIS_NONCE)
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
		`Genesis block: hash ${GENESIS_HASH}, receiver ${GENESIS_COINBASE_RECEIVER} (burned address — ${GENESIS_REWARD_NEX} NXC di-premined)`,
	)
	return block
}
