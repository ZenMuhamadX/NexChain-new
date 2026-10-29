/**
 * Operasi undo journal (WAL): tulis, terapkan (rollback), pulihkan saat boot,
 * dan pangkas.
 *
 * Alur commit (lihat `writeBuffer.ts` untuk sumber isinya):
 *   1. eksekusi blok di buffer (belum menyentuh disk);
 *   2. `journal:<h>` = { hash, entries } ditulis `sync:true` — WAL;
 *   3. flush buffer, lalu `committed:<h>` `sync:true` sebagai langkah TERAKHIR.
 *
 * Recovery boot: setiap `journal:<h>` yang TIDAK punya `committed:<h>` (flush
 * belum tuntas) atau berada di atas tip (sisa reorg) dibalik. Karena penanda
 * commit ditulis setelah semua batch selesai, "ada blok" dan "ada penanda"
 * tidak bisa berbeda pendapat.
 *
 * Rollback memulihkan `prev` sehingga idempoten dan aman diulang setelah crash
 * di tengah rollback.
 */
import { rocksJournal } from 'src/core/state/db/journal'
import { isNotFound } from 'src/core/state/db/notFound'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { logToConsole } from 'src/logging/logging'
import {
	bufferGet,
	dbFor,
	type JournalEntry,
	type JournalRecord,
	type JournalStoreName,
} from './writeBuffer'

/** Kedalaman reorg maksimum yang bisa dibalik (journal lebih tua dipangkas). */
export const MAX_REORG_DEPTH = 128

const journalKey = (height: number): string => `journal:${height}`
const committedKey = (height: number): string => `committed:${height}`

/** Tulis WAL: `sync:true` → ada di disk SEBELUM satu byte state ditulis. */
export const writeJournalRecord = async (
	record: JournalRecord,
): Promise<void> => {
	await rocksJournal.put(journalKey(record.height), record, { sync: true })
}

/** Penanda "blok ini permanen". Ditulis SETELAH flush buffer selesai. */
export const writeCommittedMarker = async (height: number): Promise<void> => {
	await rocksJournal.put(committedKey(height), '1', { sync: true })
}

const hasCommittedMarker = async (height: number): Promise<boolean> => {
	try {
		return (await rocksJournal.get(committedKey(height))) === '1'
	} catch (error) {
		if (isNotFound(error)) return false
		throw error
	}
}

/**
 * Rollback hanya boleh membalik blok yang MEMANG blok di tinggi itu. Tanpa
 * cek ini, record basi/tertukar akan "memulihkan" nilai lama ke atas rantai
 * yang berbeda — kerusakan state yang lebih buruk daripada tidak rollback.
 */
const assertRecordMatchesChain = async (
	record: JournalRecord,
): Promise<void> => {
	const pointer = await bufferGet('state', `blockHeight:${record.height}`)
	if (pointer !== null && pointer !== record.hash) {
		throw new Error(
			`Journal: record tinggi ${record.height} ber-hash ${record.hash} ` +
				`tidak cocok dengan rantai (${pointer}) — rollback ditolak.`,
		)
	}
}

/**
 * Terapkan (rollback) satu record: pulihkan `prev`/del tiap kunci, LALU hapus
 * record + penanda. Urutan "terapkan dulu baru hapus" membuat operasi
 * idempoten saat crash di tengah rollback.
 */
export const applyRecord = async (record: JournalRecord): Promise<void> => {
	for (const store of ['block', 'state', 'history'] as JournalStoreName[]) {
		const ops = record.entries
			.filter((entry) => entry.store === store)
			.map((entry: JournalEntry) =>
				entry.prev === null
					? { type: 'del' as const, key: entry.key }
					: { type: 'put' as const, key: entry.key, value: entry.prev },
			)
		if (ops.length > 0) {
			await dbFor(store).batch(ops as never, { sync: true })
		}
	}
	// Journal dihapus lebih dulu: sisa penanda tanpa journal diabaikan
	// recovery, sedangkan journal tanpa penanda akan dibalik (idempoten).
	await rocksJournal.del(journalKey(record.height))
	await rocksJournal.del(committedKey(record.height))
}

/** Tinggi tip saat ini dari `blockState`; -1 bila rantai masih kosong. */
export const currentHeight = async (): Promise<number> => {
	try {
		const state = await getBlockState()
		return typeof state?.currentBlockHeight === 'number'
			? state.currentBlockHeight
			: -1
	} catch (error) {
		if (isNotFound(error)) return -1
		throw error
	}
}

/** Semua tinggi yang punya record journal, urut menaik. */
export const listJournalHeights = async (): Promise<number[]> => {
	const heights: number[] = []
	for await (const [key] of rocksJournal.iterator()) {
		const match = /^journal:(\d+)$/.exec(String(key))
		if (match) heights.push(Number(match[1]))
	}
	return heights.sort((a, b) => a - b)
}

const readRecord = async (height: number): Promise<JournalRecord | null> => {
	try {
		const record = (await rocksJournal.get(
			journalKey(height),
		)) as unknown as JournalRecord | null
		return record ?? null
	} catch (error) {
		if (isNotFound(error)) return null
		throw error
	}
}

/** Rollback SATU blok (terapkan record lalu hapus journal-nya). */
export const rollbackBlock = async (height: number): Promise<boolean> => {
	const record = await readRecord(height)
	if (!record) return false
	await assertRecordMatchesChain(record)
	await applyRecord(record)
	return true
}

/**
 * Rollback semua blok `h > targetHeight`, MENURUN (penting untuk `address:`
 * yang read-modify-write array). Idempoten.
 */
export const rollbackAbove = async (targetHeight: number): Promise<number> => {
	const heights = (await listJournalHeights()).filter((h) => h > targetHeight)
	let rolled = 0
	for (const h of heights.sort((a, b) => b - a)) {
		if (await rollbackBlock(h)) rolled++
	}
	return rolled
}

/**
 * Recovery saat boot: balik journal yang flush-nya belum tuntas (tanpa
 * `committed:<h>`) atau yang berada di atas tip, lalu pangkas journal tua.
 * Mengembalikan jumlah blok yang dibalik.
 */
export const recoverJournal = async (): Promise<number> => {
	let rolled = 0
	const heights = (await listJournalHeights()).sort((a, b) => b - a)
	for (const height of heights) {
		if (await hasCommittedMarker(height)) {
			if (height <= (await currentHeight())) continue
		}
		await rollbackBlock(height)
		rolled++
	}
	if (rolled > 0) {
		logToConsole(
			`Journal recovery: ${rolled} blok tak-tuntas dibalik ` +
				`(tip=${await currentHeight()}).`,
		)
	}
	await pruneJournal(await currentHeight())
	return rolled
}

/** Simpan `MAX_REORG_DEPTH` record terbaru (+ penandanya); hapus sisanya. */
export const pruneJournal = async (tipHeight: number): Promise<number> => {
	if (tipHeight < 0) return 0
	const cutoff = tipHeight - MAX_REORG_DEPTH
	const heights = (await listJournalHeights()).filter((h) => h <= cutoff)
	for (const h of heights) {
		await rocksJournal.del(journalKey(h))
		await rocksJournal.del(committedKey(h))
	}
	return heights.length
}
