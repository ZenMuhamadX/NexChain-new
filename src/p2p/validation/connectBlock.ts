/**
 * Validasi + commit satu blok asing dari jaringan P2P.
 *
 * Blok dari peer TIDAK pernah dipercaya: setiap aspek diverifikasi ulang
 * dengan aturan konsensus yang sama dengan blok lokal (struktur Joi, PoW,
 * hash blok, merkle root, hadiah, timestamp, difficulty retarget), ditambah
 * pemeriksaan khas jalur P2P:
 *
 *   - **duplikat** — blok yang sudah ada tidak boleh di-commit ulang, karena
 *     `commitBlock` menjalankan `processTransact` lagi dan akan mengkredit
 *     saldo dua kali;
 *   - **kaitan ke tip** — blok yang tepat melanjutkan tip lokal (height ==
 *     tip + 1 dan `previousBlockHash` == hash tip) di-commit langsung
 *     (jalur cepat).
 *
 * ## Jalur cabang (M2 — reorg)
 *
 * Blok yang TIDAK menempel ke tip BUKAN lagi "sekadar diabaikan". Ia
 * diverifikasi terhadap INDUKNYA (bukan tip): timestamp diukur dari rantai
 * nenek moyang induk, difficulty dihitung dari induk (lokal ATAU blok pooled),
 * lalu diparkir di branch pool (`src/core/consensus/reorg/branchPool.ts`).
 * Setelah itu `reevaluateBranches()` mencari cabang terberat dan, bila memang
 * lebih berat, menjalankan reorg lewat `onCompetingTip` — SATU titik deteksi
 * (R-2). Induk yang belum tiba = orphan: blok tetap diparkir (PoW/hash/merkle/
 * hadiah sudah lolos) dan difficulty diukur ulang saat replay.
 *
 * `fatal=true` berarti pelanggaran konsensus (layak ban peer);
 * `fatal=false` berarti penolakan non-pelanggaran (cukup diabaikan).
 *
 * Fungsi ini TOTAL: tidak pernah melempar — error tak terduga diubah menjadi
 * `{ ok:false, fatal:false }`.
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
	MTP_WINDOW,
} from 'src/core/consensus/verify/module/verifyTimestamp'
import { expectedDifficulty } from 'src/core/consensus/difficulty'
import { getCurrentBlock } from 'src/core/block/query/onChain/block/getCurrentBlock'
import { GENESIS_HASH } from 'src/core/block/genesis'
import { CHAIN_ID } from 'src/crypto/chainId'
import { chains } from 'src/core/block/initBlock'
import { addToPool } from 'src/core/consensus/reorg/branchPool'
import { resolveBlock } from 'src/core/consensus/reorg/ancestry'
import { reevaluateBranches } from 'src/core/consensus/reorg/reorg'
import { hasBlock } from '../chain.js'
import type { ConnectBlockResult } from '../types.js'

/** Tolak blok dengan alasan tertentu. */
const reject = (reason: string, fatal: boolean): ConnectBlockResult => ({
	ok: false,
	reason,
	fatal,
})

/**
 * Timestamp kronologis (tua→baru) dari `parent` dan leluhurnya, maksimal
 * `MTP_WINDOW` — dipakai sebagai jendela MTP untuk blok CABANG. Berbeda dari
 * `getPreviousTimestamps(height)` (baca lokal per-height), versi ini menelusuri
 * `previousBlockHash` sehingga benar walau sebagian leluhur masih pooled.
 */
const collectAncestorTimestamps = async (parent: Block): Promise<number[]> => {
	const out: number[] = []
	let current: Block | undefined = parent
	let count = 0
	while (current !== undefined && count < MTP_WINDOW) {
		out.push(current.block.header.timestamp)
		count++
		const prev: string = current.block.header.previousBlockHash
		current = prev ? await resolveBlock(prev) : undefined
	}
	return out.reverse()
}

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
	//      dikunci `GENESIS_HASH` dan jalur cabang menolak genesis).
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

	// 9. Field konsensus yang TIDAK butuh induk (height > 0).
	if (block.block.height > 0) {
		if (!verifyMerkleRoot(block.block.transactions, block.block.merkleRoot)) {
			return reject('merkle root tidak cocok', true)
		}
		const rewardReason = verifyBlockReward(block)
		if (rewardReason !== null) {
			return reject('hadiah blok tidak valid: ' + rewardReason, true)
		}
	}

	// 10. Tip lokal + induk (boleh blok lokal atau blok pooled).
	let tip: Block | undefined
	try {
		tip = (await getCurrentBlock('json')) as Block
	} catch {
		tip = undefined
	}
	const prevHash = block.block.header.previousBlockHash
	const parent = isGenesis ? undefined : await resolveBlock(prevHash)

	// 11. JALUR CEPAT: blok tepat melanjutkan tip lokal.
	if (
		tip !== undefined &&
		block.block.height === tip.block.height + 1 &&
		prevHash === tip.block.header.hash
	) {
		const tsReason = checkBlockTimestamp(
			block.block.header.timestamp,
			await getPreviousTimestamps(block.block.height),
			Date.now(),
		)
		if (tsReason !== null) {
			return reject('timestamp blok tidak valid: ' + tsReason, true)
		}
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
		const committed = await chains.commitBlock(block)
		if (!committed.status) {
			return reject('commitBlock menolak blok', false)
		}
		return { ok: true, fatal: false }
	}

	// 12. JALUR CABANG: blok tidak menempel ke tip.
	if (isGenesis) {
		// Genesis jaringan jelas bukan cabang — kalau sampai di sini berarti
		// tip kita belum ada atau hash-nya identik (langkah 4). Abaikan.
		return reject('genesis tak menempel ke rantai lokal', false)
	}

	if (parent !== undefined) {
		// Timestamp diukur dari rantai nenek moyang INDUK (bukan lokal).
		const tsReason = checkBlockTimestamp(
			block.block.header.timestamp,
			await collectAncestorTimestamps(parent),
			Date.now(),
		)
		if (tsReason !== null) {
			return reject('timestamp blok tidak valid: ' + tsReason, true)
		}
		// Difficulty dihitung dari INDUK (lokal atau pooled) — angka header
		// tidak dipercaya. Beda = pelanggaran konsensus.
		const expected = expectedDifficulty(
			parent.block.header.difficulty,
			parent.block.header.timestamp,
			block.block.header.timestamp,
			parent.block.height,
		)
		if (block.block.header.difficulty !== expected) {
			return reject(
				`difficulty ${block.block.header.difficulty} != expected ${expected} ` +
					`(height ${block.block.height}, induk cabang)`,
				true,
			)
		}
	} else {
		// Induk belum tiba (orphan): PoW/hash/merkle/hadiah sudah lolos, tetapi
		// difficulty belum bisa diukur. Cukup cek batas masa depan; difficulty
		// divalidasi ulang oleh `commitBlock` saat cabangnya di-replay.
		const tsReason = checkBlockTimestamp(
			block.block.header.timestamp,
			[],
			Date.now(),
		)
		if (tsReason !== null) {
			return reject('timestamp blok tidak valid: ' + tsReason, true)
		}
	}

	// 13. Parkir di branch pool lalu coba reorg (satu titik: reevaluate →
	//     onCompetingTip). Blok jauh dari tip yang belum tersambung akan
	//     menunggu induknya tiba; blok yang membentuk cabang lebih berat
	//     memicu penggantian tip.
	addToPool(block)
	await reevaluateBranches()
	return { ok: true, fatal: false }
}

/**
 * Antrean serial SATU untuk SELURUH pemrosesan blok masuk.
 *
 * `onPeerMessage` di `syncManager` sengaja tidak men-await handler, sehingga
 * dua peer (atau dua pesan) bisa masuk bersamaan dan saling menyela di titik
 * `await` — berbahaya sekarang karena satu blok bisa memicu reorg (rollback +
 * replay) sementara blok lain men-`commitBlock` di jalur cepat. Antrean ini
 * menjamin hanya satu `connectBlock` berjalan pada satu waktu, jadi jalur
 * cepat dan reorg tidak pernah tumpang tindih.
 *
 * (Balapan dengan mining lokal `nex_submitWork` belum ditutup di sini; ia punya
 * antrean `workQueue` sendiri di `consensus/work.ts`. Gerbang `forked` menahan
 * job BARU, dan submitWork menolak job basi bila tip berubah.)
 */
let connectQueue: Promise<unknown> = Promise.resolve()

const serializeConnect = <T>(task: () => Promise<T>): Promise<T> => {
	const running = connectQueue.then(task)
	connectQueue = running.catch(() => undefined)
	return running
}

/**
 * Validasi blok asing dari peer, lalu commit/commit-cabang bila lolos.
 * Pemrosesan diserialkan (lihat `serializeConnect`).
 *
 * @param raw pesan `block` mentah dari peer (`{ block: {...} }` atau struct
 *            blok telanjang)
 * @returns `ok=true` bila blok diterima (di-commit ke tip ATAU diparkir di
 *          branch pool sebagai kandidat cabang); sebaliknya `reason` + `fatal`
 *          menentukan apakah peer layak di-ban
 */
export const connectBlock = (raw: unknown): Promise<ConnectBlockResult> =>
	serializeConnect(async () => {
		try {
			return await runChecks(raw)
		} catch (err) {
			// Fungsi total: error tak terduga tidak boleh menjatuhkan handler P2P.
			const message = err instanceof Error ? err.message : String(err)
			return { ok: false, reason: message, fatal: false }
		}
	})
