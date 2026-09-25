/**
 * Gerbang genesis (standar Bitcoin — konstanta hardcoded).
 *
 *   bun run genesis:check            → verifikasi GENESIS_NONCE/GENESIS_HASH
 *                                      konsisten dengan konstanta saat ini.
 *   bun run genesis:solve            → cari nonce + hash baru (dipakai saat
 *                                      fork: ubah konstanta / NEX_CHAIN_ID,
 *                                      lalu tempel hasilnya ke genesis.ts).
 *
 * Murni: tidak menyentuh DB. `NEX_CHAIN_ID` ikut menentukan hasil — solve
 * harus dijalankan dengan env chain id yang sama dengan jaringan tujuan.
 */
import { buildGenesisBlock } from 'nexchain/block/genesis'
import {
	GENESIS_HASH,
	GENESIS_NONCE,
	assertGenesisValid,
} from 'nexchain/block/genesis'
import { prepareBlockForHashing } from 'nexchain/block/prepareBlock'
import { hashWithNonce } from 'nexchain/miner/Pow'
import {
	INITIAL_DIFFICULTY_BITS,
	meetsDifficulty,
} from 'nexchain/miner/difficulty'
import { CHAIN_ID } from 'sign/chainId'

const solve = process.argv.includes('--solve')

if (solve) {
	const payload = prepareBlockForHashing(buildGenesisBlock())
	let nonce = 0
	let hash = hashWithNonce(payload, nonce)
	while (!meetsDifficulty(hash, INITIAL_DIFFICULTY_BITS)) {
		nonce++
		hash = hashWithNonce(payload, nonce)
	}
	console.log(`NEX_CHAIN_ID = ${CHAIN_ID}`)
	console.log(`GENESIS_NONCE = ${nonce}`)
	console.log(`GENESIS_HASH = ${hash}`)
	console.log(
		'\nTempel kedua nilai tersebut ke nexchain/block/genesis.ts, lalu jalankan `bun run genesis:check`.',
	)
	process.exit(0)
}

try {
	assertGenesisValid()
	console.log(`OK  genesis valid (chain id ${CHAIN_ID})`)
	console.log(`    hash  ${GENESIS_HASH}`)
	console.log(`    nonce ${GENESIS_NONCE}`)
	console.log(`    diff  ${INITIAL_DIFFICULTY_BITS} bits`)
} catch (error) {
	console.error(
		`FAIL ${error instanceof Error ? error.message : 'constanta genesis tidak valid'}`,
	)
	process.exit(1)
}