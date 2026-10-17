/** @format */

// BlockChains.ts
import { generateTimestampz } from 'src/core/encoding/lib/generateTimestamp'
import { Block } from 'src/core/block/blockModel'
import { saveBlock } from 'src/core/state/storage/block/saveBlock'
import { loggingErr } from '../../logging/errorLog'
import { verifyChainIntegrity } from 'src/core/consensus/verify/verifyIntegrity'
import { verifyMerkleRoot } from 'src/core/consensus/verify/module/verifyMerkleRoot'
import { verifyBlockReward } from 'src/core/consensus/verify/module/verifyReward'
import { verifyBlockNonceOrder } from 'src/core/consensus/verify/module/verifyNonce'
import {
	checkBlockTimestamp,
	getPreviousTimestamps,
} from 'src/core/consensus/verify/module/verifyTimestamp'
import { expectedDifficulty } from 'src/core/consensus/difficulty'
import { getBlockByHeight } from '../block/query/onChain/block/getBlockByHeight'
import { processTransact } from 'src/core/transaction/processTransaction'
import { logToConsole } from 'src/logging/logging'
import { loggingDebug } from 'src/logging/debug'
import { projectTotalIssued } from 'src/core/state/storage/state/setState'
import { MAX_SUPPLY_NEXU, NEXU_PER_NXC } from 'src/core/token/constants'
import {
	beginJournalContext,
	endJournalContext,
} from 'src/core/state/journal/guard'
import {
	prepareJournalRecord,
	pruneJournal,
	rollbackBlock,
	writeJournalRecord,
} from 'src/core/state/journal/store'

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
	 *   2. verifikasi HADIAH & FEE (direhitung — `verifyBlockReward`) dan
	 *      TIMESTAMP (MTP-11 + batas masa depan — `checkBlockTimestamp`);
	 *   3. verifikasi PLAFON SUPLAI — `totalIssued` proyektif belum melewati
	 *      50 juta NXC. Dilakukan di sini (sebelum menulis apa pun) supaya
	 *      penolakan bersih, bukan setengah-blok di DB;
	 *   4. **undo journal (WAL)** — enumerasi touch-set, snapshot nilai lama,
	 *      lalu tulis `journal:<h>` dengan `sync:true` SEBELUM tulisan state
	 *      apa pun. Sejak titik ini guard journal aktif: menulis kunci yang
	 *      tak terenumerasi → throw (fail-closed) → blok dibatalkan +
	 *      rollback best-effort (boot recovery sebagai jaring pengaman);
	 *   5. simpan blok ke DB (hash/height/state) — nilai return `saveBlock`
	 *      kini DIPERIKSA (dulu diabaikan: blok bisa gagal tersimpan tapi
	 *      hadiah & transaksi tetap diproses);
	 *   6. proses SELURUH transaksi blok lewat `processTransact` — termasuk
	 *      transaksi coinbase, sehingga hadiah blok terkredit melalui
	 *      pipeline transaksi yang sama (pengganti `giveReward`/`putAccount`
	 *      langsung) dan ikut terindex di riwayat alamat.
	 *
	 * (Langkah deploy kontrak DIHAPUS bersama fitur smart contract.)
	 */
	public async commitBlock(
		block: Block,
	): Promise<{ status: boolean; block: Block | undefined }> {
		// Tinggi blok yang WAL-nya sudah tertulis; `null` = belum ada tulisan
		// journal, jadi tidak ada yang perlu di-rollback bila gagal.
		let journalHeight: number | null = null
		try {
			if (!verifyMerkleRoot(block.block.transactions, block.block.merkleRoot)) {
				throw new Error('Merkle root verification failed.')
			}

			// ---- HADIAH & FEE (aturan konsensus, direhitung) ---------------
			// Semua nilai reward dihitung ulang dari fungsi deterministik —
			// field blok TIDAK dipercaya. Gagal-dulu: sebelum supply-cap,
			// sebelum satu byte pun menyentuh DB.
			const rewardReason = verifyBlockReward(block)
			if (rewardReason !== null) {
				throw new Error(`Block reward verification failed: ${rewardReason}`)
			}

			// ---- TIMESTAMP (MTP-11 + batas masa depan 2 jam) ---------------
			// Blok template disusun agar tervalidasi MTP oleh konstruksi;
			// cek ulang di sini menutup jalur submit di luar template.
			const timestampReason = checkBlockTimestamp(
				block.block.header.timestamp,
				await getPreviousTimestamps(block.block.height),
				Date.now(),
			)
			if (timestampReason !== null) {
				throw new Error(
					`Block timestamp verification failed: ${timestampReason}`,
				)
			}

			// ---- DIFFICULTY (retarget deterministik, DIHITUNG ULANG) -------
			// Angka di `header.difficulty` TIDAK dipercaya: ia dihitung ulang
			// dari data rantai induk lewat fungsi murni `expectedDifficulty`.
			// Blok dengan difficulty palsu (mis. 8 padahal seharusnya 24)
			// ditolak di sini — inilah yang menutup celah "mine at floor".
			// Genesis (height 0) dikecualikan: ditulis lewat jalur bootstrap,
			// bukan commitBlock.
			if (block.block.height > 0) {
				const parent = (await getBlockByHeight(block.block.height - 1)) as
					Block | undefined
				if (parent) {
					const expected = expectedDifficulty(
						parent.block.header.difficulty,
						parent.block.header.timestamp,
						block.block.header.timestamp,
						parent.block.height,
					)
					if (block.block.header.difficulty !== expected) {
						throw new Error(
							`Difficulty mismatch at height ${block.block.height}: ` +
								`header ${block.block.header.difficulty}, expected ${expected}`,
						)
					}
				}
			}

			// ---- PLAFON SUPLAI (gagal-dulu, sebelum menulis apa pun) ------
			// Diverifikasi di sini, bukan hanya di `setBlockState`, supaya
			// penolakan terjadi SEBELUM `writeBlockHash`/`writeBlockHeight`
			// menyentuh DB. Kalau baru terdeteksi saat menulis, blok sudah
			// setengah tersimpan dan `processTransact` bisa berjalan di atas
			// state yang tidak konsisten.
			const projectedIssued = await projectTotalIssued(block)
			if (projectedIssued > MAX_SUPPLY_NEXU) {
				throw new Error(
					`Plafon suplai terlampaui: totalIssued ${projectedIssued} > ` +
						`${MAX_SUPPLY_NEXU} (${MAX_SUPPLY_NEXU / NEXU_PER_NXC} NXC) ` +
						`di blok height=${block.block.height} — blok ditolak.`,
				)
			}

			// ---- URUTAN NONCE per-pengirim (gagal-dulu, sebelum WAL) ----
			// Menegakkan "masuk blok ⇒ tereksekusi": tiap tx non-duplikat
			// wajib tepat nonce yang diharapkan pengirimnya (kontigu dari
			// `account.nonce` pra-blok). Tanpa ini, fee tx nonce-lompat ikut
			// dibayar ke miner lewat coinbase padahal tx-nya tidak pernah
			// didebet. Tx yang `isTxExecuted` dilewati (residu crash) tanpa
			// memajukan penghitung. Dilempar sebagai `NonceMismatchError`
			// dan ditangani jalur gagal yang sama di bawah (di titik ini
			// `journalHeight` masih null — belum ada yang ditulis, jadi
			// tidak ada yang perlu di-rollback). Genesis tidak lewat jalur
			// ini (disimpan langsung via `saveBlock` saat bootstrap).
			await verifyBlockNonceOrder(block)

			// ---- UNDO JOURNAL (WAL, sebelum tulisan state apa pun) --------
			// Enumerasi semua kunci yang akan disentuh + snapshot nilai
			// lamanya, lalu tulis `journal:<h>` (sync). Guard dinyalakan
			// SETELAH WAL aman di disk; semua tulisan state/history/block
			// berikutnya dicek keanggotaannya.
			const { record, touch } = await prepareJournalRecord(block)
			await writeJournalRecord(record)
			journalHeight = record.height
			beginJournalContext(touch)

			await this.saveBlockToChain(block)

			// Tidak lagi dipisah `transactionsToProcess` vs hadiah: satu
			// pemanggilan memproses coinbase + transaksi pengguna. Blok
			// diteruskan supaya `processTransact` bisa mencatat asal blok
			// (tinggi/hash/timestamp) ke riwayat tiap transaksi — itulah
			// sumber waktu transaksi, karena transaksi sendiri tidak lagi
			// menyimpan timestamp.
			await processTransact(block.block.transactions, block.block)

			endJournalContext()

			// Journal blok ini kini "terpakai"; pangkas yang lebih tua dari
			// MAX_REORG_DEPTH supaya store tidak tumbuh tanpa batas.
			await pruneJournal(block.block.height)

			return { block, status: true }
		} catch (error) {
			endJournalContext()

			// Best-effort rollback: bila WAL sudah tertulis tetapi commit
			// gagal di tengah (mis. guard menolak kunci tak terdaftar, atau
			// storage error), kembalikan state persis ke sebelum blok ini.
			// Boot recovery tetap jaring pengaman bila proses mati di sini.
			if (journalHeight !== null) {
				try {
					await rollbackBlock(journalHeight)
				} catch (rollbackError) {
					console.error(
						'Journal rollback gagal (boot recovery akan menanganinya):',
						rollbackError,
					)
				}
			}

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
