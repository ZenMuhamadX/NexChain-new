/**
 * Validasi + commit satu blok asing dari jaringan P2P.
 *
 * Blok dari peer TIDAK pernah dipercaya: setiap aspek diverifikasi ulang
 * dengan aturan konsensus yang sama dengan blok lokal (struktur Joi, PoW,
 * hash blok, merkle root, hadiah, timestamp, difficulty retarget), ditambah
 * dua pemeriksaan yang khas jalur P2P:
 *
 *   - **duplikat** — blok yang sudah ada tidak boleh di-commit ulang,
 *     karena `commitBlock` menjalankan `processTransact` lagi dan akan
 *     mengkredit saldo dua kali;
 *   - **kaitan ke tip** — blok baru harus tepat melanjutkan tip lokal
 *     (height == tip + 1 dan `previousBlockHash` == hash tip), sehingga
 *     blok yang tidak menempel cukup diabaikan (bukan pelanggaran — bisa
 *     jadi tembakan lintas karena race).
 *
 * `fatal=true` berarti pelanggaran konsensus (layak ban peer);
 * `fatal=false` berarti penolakan non-pelanggaran (cukup diabaikan).
 *
 * Fungsi ini TOTAL: tidak pernah melempar — error tak terduga diubah
 * menjadi `{ ok:false, fatal:false }`.
 */
import { Block } from 'src/core/block/blockModel'
import type { blockStruct } from 'src/types/block'
import { verifyStruct } from 'src/core/consensus/verify/module/verifyStruct'
import { verifyHashLength } from 'src/core/consensus/verify/module/verifyHashLength'
import { verifyPow } from 'src/core/consensus/verify/module/verifyPow'
import { verifyBlockHash } from 'src/core/consensus/verify/module/verifyBlockHash'
import { verifyMerkleRoot } from 'src/core/consensus/verify/module/verifyMerkleRoot'
import { verifyBlockReward } from 'src/core/consensus/verify/module/verifyReward'
import {
	checkBlockTimestamp,
	getPreviousTimestamps,
} from 'src/core/consensus/verify/module/verifyTimestamp'
import { expectedDifficulty } from 'src/core/consensus/difficulty'
import { getCurrentBlock } from 'src/core/block/query/onChain/block/getCurrentBlock'
import { GENESIS_HASH } from 'src/core/block/genesis'
import { CHAIN_ID } from 'src/crypto/chainId'
import { chains } from 'src/core/block/initBlock'
import { hasBlock } from '../chain.js'
import type { ConnectBlockResult } from '../types.js'

/** Tolak blok dengan alasan tertentu. */
const reject = (reason: string, fatal: boolean): ConnectBlockResult => ({
	ok: false,
	reason,
	fatal,
})

/**
 * Badan validasi — dipanggil `connectBlock` di dalam try/catch, sehingga
 * setiap throw di sini berubah jadi penolakan non-fatal.
 */
const runChecks = async (raw: unknown): Promise<ConnectBlockResult> => {
	// 1. Guard bentuk: harus objek non-null, lalu susun `Block`.
	//    Pesan P2P `block` membawa `{ block: {...} }` (serialisasi `Block`
	//    milik kita); struct telanjang juga diterima.
	if (typeof raw !== 'object' || raw === null) {
		return reject('bentuk blok tidak valid', true)
	}
	const source = 'block' in raw ? (raw as { block: unknown }).block : raw
	let block: Block
	try {
		block = new Block(source as blockStruct)
	} catch {
		return reject('bentuk blok tidak valid', true)
	}

	// 2. Hash ada dan panjangnya 64 karakter (SHA-256 hex).
	const hash = block.block.header.hash
	if (typeof hash !== 'string' || !verifyHashLength(hash)) {
		return reject('hash tidak valid', true)
	}

	// 3. Chain id harus milik jaringan kita — rantai lain = bukan milik kita.
	if (block.block.chainId !== CHAIN_ID) {
		return reject('chain id berbeda', true)
	}

	// 4. Duplikat: jangan PERNAH re-commit (kredit ganda via processTransact).
	if (await hasBlock(hash)) {
		return reject('blok sudah ada', false)
	}

	// 5. Identitas genesis dikunci konstanta `GENESIS_HASH` (anti-fork).
	//    Genesis biasanya sudah ada sehingga langkah 4 lebih dulu mengembalikan.
	const isGenesis = block.block.height === 0
	if (isGenesis && hash !== GENESIS_HASH) {
		return reject('genesis tidak dikenal', true)
	}

	// 6. Struktur (Joi, fail-closed).
	if (!(await verifyStruct(block))) {
		return reject('struktur blok tidak valid', true)
	}

	// 7–8. PoW + hash blok vs isinya (genesis dilewati: identitasnya sudah
	//      dikunci `GENESIS_HASH` dan langkah 10 tetap menuntut kaitan tip).
	if (!isGenesis) {
		if (!verifyPow(block)) {
			return reject('PoW tidak memenuhi difficulty', true)
		}
		let hashMatches = false
		try {
			hashMatches = verifyBlockHash(block)
		} catch {
			// verifyBlockHash MELEMPAR bila hash tidak cocok — samakan
			// perilakunya dengan `false`.
			hashMatches = false
		}
		if (!hashMatches) {
			return reject('hash blok tidak cocok dengan isinya', true)
		}
	}

	// 9. Field konsensus khusus blok non-genesis (height > 0).
	if (block.block.height > 0) {
		if (!verifyMerkleRoot(block.block.transactions, block.block.merkleRoot)) {
			return reject('merkle root tidak cocok', true)
		}
		const rewardReason = verifyBlockReward(block)
		if (rewardReason !== null) {
			return reject('hadiah blok tidak valid: ' + rewardReason, true)
		}
		const tsReason = checkBlockTimestamp(
			block.block.header.timestamp,
			await getPreviousTimestamps(block.block.height),
			Date.now(),
		)
		if (tsReason !== null) {
			return reject('timestamp blok tidak valid: ' + tsReason, true)
		}
	}

	// 10. Kaitan ke tip lokal — pemeriksaan khas P2P: blok baru harus
	//     tepat melanjutan rantai kita, bukan cabang yang menggantung.
	let tip: Block
	try {
		tip = (await getCurrentBlock('json')) as Block
	} catch {
		// Belum ada tip (rantai kosong / state belum siap) — bukan
		// pelanggaran, cukup tolak tanpa ban.
		return reject('tip lokal belum tersedia', false)
	}
	if (block.block.height !== tip.block.height + 1) {
		return reject(
			`tidak menempel ke tip (tinggi ${block.block.height}, tip ${tip.block.height})`,
			false,
		)
	}
	if (block.block.header.previousBlockHash !== tip.block.header.hash) {
		return reject('previousBlockHash tidak cocok dengan tip', false)
	}

	// 10b. Difficulty: DIHITUNG ULANG dari data rantai (deterministik) —
	//      angka di header TIDAK dipercaya. Karena blok sudah dipastikan
	//      menempel ke tip (height+1 & prevHash cocok), tip = induknya.
	//      Beda = pelanggaran konsensus (layak ban), sama seperti PoW palsu.
	const expected = expectedDifficulty(
		tip.block.header.difficulty,
		tip.block.header.timestamp,
		block.block.header.timestamp,
		tip.block.height,
	)
	if (block.block.header.difficulty !== expected) {
		return reject(
			`difficulty ${block.block.header.difficulty} != expected ${expected} ` +
				`(height ${block.block.height})`,
			true,
		)
	}

	// 11. Commit. Gagal simpan = gangguan storage/suplai, bukan pelanggaran
	//     peer — pemeriksaan konsensus di atas sudah menutup blok nakal.
	const committed = await chains.commitBlock(block)
	if (!committed.status) {
		return reject('commitBlock menolak blok', false)
	}

	// 12. Lolos seluruh pemeriksaan.
	return { ok: true, fatal: false }
}

/**
 * Validasi blok asing dari peer, lalu commit bila seluruh cek lolos.
 *
 * @param raw pesan `block` mentah dari peer (`{ block: {...} }` atau struct
 *            blok telanjang)
 * @returns `ok=true` bila blok ter-commit; sebaliknya `reason` + `fatal`
 *          menentukan apakah peer layak di-ban
 */
export const connectBlock = async (
	raw: unknown,
): Promise<ConnectBlockResult> => {
	try {
		return await runChecks(raw)
	} catch (err) {
		// Fungsi total: error tak terduga tidak boleh menjatuhkan handler P2P.
		const message = err instanceof Error ? err.message : String(err)
		return { ok: false, reason: message, fatal: false }
	}
}
