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
	bufferEntries,
	bufferStateLeaves,
	beginWriteBuffer,
	discardWriteBuffer,
	flushWriteBuffer,
	type JournalRecord,
} from 'src/core/state/journal/writeBuffer'
import { computeStateRoot, EMPTY_STATE_ROOT } from 'src/core/state/root'
import {
	pruneJournal,
	rollbackBlock,
	writeCommittedMarker,
	writeJournalRecord,
} from 'src/core/state/journal/store'
import { withCommitLock } from './commitLock'

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
	 *   4. **eksekusi di write-buffer** — `saveBlock` + `processTransact`
	 *      hanya menumpuk tulisan (kunci + nilai lama) di RAM, nol byte ke
	 *      disk. Isi buffer itu sendiri yang menjadi undo journal, jadi tidak
	 *      ada enumerasi terpisah yang bisa meleset dari tulisan sebenarnya;
	 *   5. **WAL** `journal:<h>` `sync:true`;
	 *   6. **flush** seluruh buffer, lalu `committed:<h>` `sync:true` sebagai
	 *      langkah terakhir — blok baru permanen setelah penanda ini. Eror di
	 *      titik mana pun ⟹ buffer dibuang + rollback dari WAL.
	 *
	 * (Langkah deploy kontrak DIHAPUS bersama fitur smart contract.)
	 */
	public async commitBlock(
		block: Block,
	): Promise<{ status: boolean; block: Block | undefined }> {
		// Serialisasi global: jalur mining, P2P, dan reorg punya antrean
		// masing-masing, tetapi yang harus dijamin satu-satu adalah COMMIT-nya
		// (write-buffer journal bersifat global) — lihat `commitLock.ts`.
		return withCommitLock(() => this.commitUnlocked(block))
	}

	private async commitUnlocked(
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
			//
			// Induk yang sama dipakai lagi di bawah untuk `stateRoot`.
			const parent =
				block.block.height > 0
					? ((await getBlockByHeight(block.block.height - 1)) as
							Block | undefined)
					: undefined
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

			// ---- EKSEKUSI DI BUFFER (belum menyentuh disk) -----------------
			// Selama buffer aktif, `putAccount`/`saveTxHistory`/`saveTxByAddress`/
			// `saveBlock`/`writeBlockHash` hanya menumpuk tulisan + nilai lama.
			// Jadi journal di bawah BUKAN hasil enumerasi yang bisa bocor: ia
			// adalah daftar tulisan yang benar-benar akan terjadi.
			beginWriteBuffer()
			await this.saveBlockToChain(block)

			// Tidak lagi dipisah `transactionsToProcess` vs hadiah: satu
			// pemanggilan memproses coinbase + transaksi pengguna. Blok
			// diteruskan supaya `processTransact` bisa mencatat asal blok
			// (tinggi/hash/timestamp) ke riwayat tiap transaksi — itulah
			// sumber waktu transaksi, karena transaksi sendiri tidak lagi
			// menyimpan timestamp.
			await processTransact(block.block.transactions, block.block)

			// ---- stateRoot: BANDINGKAN dengan hasil eksekusi sendiri -------
			// Eksekusi di buffer adalah kebenaran; `header.stateRoot` hanya
			// klaim. Bedanya sedikit saja berarti blok dibangun di atas state
			// yang berbeda (atau klaimnya dipalsukan) → blok ditolak SEBELUM
			// WAL, jadi tidak ada yang perlu di-rollback (journalHeight null).
			const computedRoot = computeStateRoot(
				parent?.block.header.stateRoot ?? EMPTY_STATE_ROOT,
				bufferStateLeaves(),
			)
			if (block.block.header.stateRoot !== computedRoot) {
				throw new Error(
					`stateRoot mismatch at height ${block.block.height}: ` +
						`header ${block.block.header.stateRoot}, computed ${computedRoot}`,
				)
			}

			// ---- WAL (sync) -----------------------------------------------
			// Sampai titik ini nol byte state menyentuh disk; crash di sini
			// tidak meninggalkan apa pun.
			const record: JournalRecord = {
				height: block.block.height,
				hash: block.block.header.hash,
				entries: bufferEntries(),
			}
			await writeJournalRecord(record)
			journalHeight = record.height

			// ---- FLUSH + penanda commit (langkah TERAKHIR) ----------------
			// Crash di antara keduanya = blok di disk tetapi belum permanen;
			// recovery membalik lewat journal, jadi tidak ada blok "setengah".
			await flushWriteBuffer()
			await writeCommittedMarker(record.height)
			discardWriteBuffer()

			// Journal blok ini kini "terpakai"; pangkas yang lebih tua dari
			// MAX_REORG_DEPTH supaya store tidak tumbuh tanpa batas.
			await pruneJournal(block.block.height)

			return { block, status: true }
		} catch (error) {
			discardWriteBuffer()

			// Best-effort rollback: bila WAL sudah tertulis tetapi flush/penanda
			// gagal, kembalikan state persis ke sebelum blok ini (idempoten).
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
