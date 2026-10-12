import { Block } from 'src/core/block/blockModel'
import { cutBlockReward } from 'src/core/block/distributeBlockReward'
import { calculateTotalFees } from 'src/core/transaction/utils/totalFees'
import {
	calculateTotalBlockReward,
	GAS_PRICE_NEXU,
} from 'src/core/consensus/calculateReward'

/**
 * Verifikasi **hadiah & fee blok** — aturan konsensus, bukan sekadar
 * konsistensi penyimpanan.
 *
 * Semua nilai DIREHITUNG dari fungsi deterministik yang sama dengan
 * `createBlockTemplate` (`cutBlockReward`, `calculateTotalFees`,
 * `calculateTotalBlockReward`, `GAS_PRICE_NEXU`) — TIDAK PERNAH mempercayai
 * field blok. Karena kedua sisi menjalankan operasi IEEE-754 yang persis sama
 * atas input yang sama, perbandingan `===` ketat benar: tidak ada epsilon,
 * tidak ada pembulatan (nilai yang berbeda sedikit pun = blok curang).
 *
 * Yang dicegah: penambang (atau peer) menulis blok yang menaikkan
 * `blockReward`/`totalReward` sendiri, menggeser `coinbaseTransaction`
 * ke alamat lain, atau memalsukan `totalTransactionFees` — semua itu akan
 * terkredit lewat `processTransact` bila lolos.
 *
 * @param block blok yang akan diperiksa
 * @returns `null` bila valid, atau alasan singkat bila tidak.
 */
export const verifyBlockReward = (block: Block): string | null => {
	// Pengecualian genesis — selaras dengan pengecualian merkle sentinel di
	// `verifyIntegrity.ts`: genesis disusun oleh KODE (bukan template),
	// reward-nya dibakar ke alamat void, dan identitasnya dikunci oleh
	// `GENESIS_HASH` + `assertGenesisValid` (re-solve bila konstanta berubah).
	// Angka reward genesis (`GENESIS_REWARD_NEX`) sengaja berbeda dari
	// `cutBlockReward(0)` dan gasPrice-nya 0 — tidak boleh dijadikan acuan
	// aturan hadiah blok biasa.
	if (block.block.height === 0) return null

	// 1. blockReward === cutBlockReward(height) — jadwal hadiah, tanpa
	//    perubahan matematika: hanya membandingkan ulang.
	const expectedBlockReward = cutBlockReward(block.block.height)
	if (block.block.blockReward !== expectedBlockReward) {
		return `blockReward ${block.block.blockReward} != ${expectedBlockReward}`
	}

	// 2. totalTransactionFees === Σ fee transaksi (direhitung, bukan dibaca).
	const expectedFees = calculateTotalFees(block.block.transactions)
	if (block.block.totalTransactionFees !== expectedFees) {
		return `totalTransactionFees ${block.block.totalTransactionFees} != ${expectedFees}`
	}

	// 3. metadata.gasPrice === konstanta. Metadata hilang pada height > 0
	//    = gagal (template selalu menulisnya; hilang berarti blok bukan
	//    hasil penyusunan yang sah / sudah dimanipulasi).
	const gasPrice = block.block.metadata?.gasPrice
	if (gasPrice !== GAS_PRICE_NEXU) {
		return `gasPrice ${gasPrice} != ${GAS_PRICE_NEXU}`
	}

	// 4. totalReward === blockReward + gasPrice + fees (ketiganya hasil
	//    recompute di atas — bukan field blok yang dipercaya).
	const expectedTotalReward = calculateTotalBlockReward(
		expectedBlockReward,
		GAS_PRICE_NEXU,
		expectedFees,
	)
	if (block.block.totalReward !== expectedTotalReward) {
		return `totalReward ${block.block.totalReward} != ${expectedTotalReward}`
	}

	// 5. Coinbase MEMBAYAR persis totalReward yang direhitung.
	const coinbase = block.block.coinbaseTransaction
	if (coinbase.amount !== expectedTotalReward) {
		return `coinbase.amount ${coinbase.amount} != ${expectedTotalReward}`
	}

	// 6. Coinbase dibayar ke miner yang sama dengan `minerId` yang ikut
	//    preimage PoW — mencegah pengalihan hadiah tanpa mengulang PoW.
	if (coinbase.receiver !== block.block.minerId) {
		return `coinbase.receiver != minerId`
	}

	return null
}
