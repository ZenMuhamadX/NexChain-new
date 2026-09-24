/** @format */

// BlockChains.ts
import { generateTimestampz } from '../lib/generateTimestampz'
import { Block } from '../model/block/block'
import { saveBlock } from '../storage/block/saveBlock'
import { loggingErr } from '../../logging/errorLog'
import { verifyChainIntegrity } from '../miner/verify/verifyIntegrity'
import { verifyMerkleRoot } from '../miner/verify/module/verifyMerkleRoot'
import { processTransact } from '../transaction/processTransact'
import { logToConsole } from 'logging/logging'
import { loggingDebug } from 'logging/debug'
import { getCurrentBlock } from '../block/query/onChain/block/getCurrentBlock'

export class BlockChains {
	constructor() {
		logToConsole('Chains called...')
		loggingDebug('blockchain:constructor', 'Chains Called...')
	}

	/**
	 * Kunci (commit) sebuah blok yang SUDAH lengkap — template dari
	 * `createBlockTemplate` yang sudah ditemukan solusi PoW-nya oleh miner
	 * eksternal dan difinalisasi di `nex_submitWork` (nonce/hash/sign/size).
	 *
	 * Urutan:
	 *   1. verifikasi merkle root (blok gagal simpan bila tidak cocok);
	 *   2. simpan blok ke DB (hash/height/state) — nilai return `saveBlock`
	 *      kini DIPERIKSA (dulu diabaikan: blok bisa gagal tersimpan tapi
	 *      hadiah & transaksi tetap diproses);
	 *   3. proses SELURUH transaksi blok lewat `processTransact` — termasuk
	 *      transaksi coinbase, sehingga hadiah blok terkredit melalui
	 *      pipeline transaksi yang sama (pengganti `giveReward`/`putAccount`
	 *      langsung) dan ikut terindex di riwayat alamat.
	 *
	 * (Langkah deploy kontrak DIHAPUS bersama fitur smart contract.)
	 */
	public async commitBlock(
		block: Block,
	): Promise<{ status: boolean; block: Block | undefined }> {
		try {
			if (!verifyMerkleRoot(block.block.transactions, block.block.merkleRoot)) {
				throw new Error('Merkle root verification failed.')
			}

			await this.saveBlockToChain(block)

			// Tidak lagi dipisah `transactionsToProcess` vs hadiah: satu
			// pemanggilan memproses coinbase + transaksi pengguna.
			await processTransact(block.block.transactions)

			return { block, status: true }
		} catch (error) {
			loggingErr({
				message: error instanceof Error ? error.message : 'Unknown error',
				context: 'BlockChains',
				level: 'error',
				priority: 'high',
				timestamp: generateTimestampz(),
				hint: 'Error committing block to chain',
				stack: new Error().stack!,
			})

			return {
				block: undefined,
				status: false,
			}
		}
	}

	private async saveBlockToChain(newBlock: Block): Promise<void> {
		try {
			loggingDebug('blockchain:saveBlockToChain', 'saving block to chain')
			const saved = await saveBlock(newBlock)
			// saveBlock MENANGKAP error dan membalikkan false — tanpa cek ini
			// blok yang gagal ditulis tetap dianggap sukses (bug lama).
			if (!saved) {
				throw new Error('saveBlock returned false')
			}
			loggingDebug('blockchain:saveBlockToChain', 'block saved successfully')
		} catch (saveError) {
			loggingErr({
				message:
					saveError instanceof Error ? saveError.message : 'Unknown error',
				context: 'BlockChains',
				level: 'error',
				priority: 'high',
				timestamp: generateTimestampz(),
				hint: 'Error saving block to chain',
				stack: new Error().stack || '',
			})
			throw new Error('Failed to save block: ' + saveError)
		}
	}

	/**
	 * Verifies the validity of a given block and the integrity of the blockchain.
	 * @returns True if the block and chain are valid, otherwise false.
	 */
	public async verify(): Promise<boolean> {
		loggingDebug('blockchain:verify', 'verifying chain integrity')
		return await verifyChainIntegrity()!
	}
}

/**
 * Timestamp (epoch ms) blok TERAKHIR / tip — dasar retarget berbasis waktu
 * (`retargetByTime` dan jalur expiry `cleanupExpiredJobs`).
 *
 * `getCurrentBlock` melempar bila state atau blok belum siap (database kosong
 * / genesis belum terbentuk). Dalam kasus itu fungsi ini mengembalikan
 * `fallbackMs` (default `Date.now()`), yang membuat `actualMs ≈ 0` sehingga
 * retarget otomatis flat (tanpa koreksi) — aman dipanggil lebih awal pada
 * setiap `nex_getWork` tanpa perlu membedakan status rantai.
 *
 * @param fallbackMs nilai pakai bila tip belum tersedia.
 */
export const getLastBlockTimestamp = async (
	fallbackMs: number = Date.now(),
): Promise<number> => {
	try {
		const tip = (await getCurrentBlock('json')) as Block
		const ts = tip?.block?.header?.timestamp
		if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) return ts
	} catch {
		// state / blok belum siap — jatuh ke fallback di bawah
	}
	return fallbackMs
}
