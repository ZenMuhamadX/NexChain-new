/**
 * Operasi undo journal (WAL): siapkan, tulis, terapkan (rollback), pulihkan
 * saat boot, dan pangkas.
 *
 * Alur commit (lihat `journal-difficulty-design.md` A.3):
 *   1. enumerasi touch-set (murni, dari blok);
 *   2. baca nilai lama SEMUA kunci touch (SEBELUM tulisan apa pun);
 *   3. tulis `journal:<h>` = { hash, entries } dengan `sync:true` (WAL);
 *   4. tulisan state/history/block (dijaga guard);
 *   5. selesai — record disimpan untuk reorg/nanti.
 *
 * Recovery boot (A.4): rollback semua `journal:<h>` dengan
 * `h > blockState.currentBlockHeight`. Karena `blockState` + `blockHeight:<h>`
 * satu batch atomik, `blockState = h` menjamin tulisan blok `h` selesai —
 * tak perlu "done marker". Rollback idempoten (memulihkan `prev`) sehingga
 * aman diulang setelah crash di tengah rollback.
 */
import { rocksJournal } from 'src/core/state/db/journal'
import { rocksState } from 'src/core/state/db/state'
import { rocksHistory } from 'src/core/state/db/history'
import { rocksBlock } from 'src/core/state/db/block'
import { getBlockState } from 'src/core/state/storage/state/getState'
import { logToConsole } from 'src/logging/logging'
import { Block } from 'src/core/block/blockModel'
import {
	enumerateTouchSet,
	type JournalEntry,
	type JournalRecord,
} from './entry'
import type { JournalStoreName, JournalTouchSet } from './guard'

/** Kedalaman reorg maksimum yang bisa dibalik (journal lebih tua dipangkas). */
export const MAX_REORG_DEPTH = 128

const journalKey = (height: number): string => `journal:${height}`

/** `null` bila kunci memang belum ada; error lain DILEMPAR (jangan disamarkan). */
const isNotFound = (error: unknown): boolean => {
	if (typeof error !== 'object' || error === null) return false
	const e = error as { code?: unknown; notFound?: unknown; name?: unknown }
	return (
		e.notFound === true ||
		e.code === 'LEVEL_NOT_FOUND' ||
		e.code === 'ERR_LEVEL_NOT_FOUND' ||
		e.name === 'NotFoundError'
	)
}

const dbFor = (store: JournalStoreName) => {
	if (store === 'state') return rocksState
	if (store === 'history') return rocksHistory
	return rocksBlock
}

/** Normalisasi nilai DB ke string|null (nilai non-string di-JSON-kan). */
const toPrev = (value: unknown): string | null => {
	if (value === undefined || value === null) return null
	if (typeof value === 'string') return value
	return JSON.stringify(value)
}

const readPrev = async (
	store: JournalStoreName,
	key: string,
): Promise<string | null> => {
	try {
		return toPrev(await dbFor(store).get(key))
	} catch (error) {
		if (isNotFound(error)) return null
		throw error
	}
}

/** Baca nilai lama semua kunci touch (langkah 2 alur commit). */
export const capturePrev = async (
	touch: JournalTouchSet,
): Promise<JournalEntry[]> => {
	const entries: JournalEntry[] = []
	const stores: JournalStoreName[] = ['state', 'history', 'block']
	for (const store of stores) {
		for (const key of touch[store]) {
			entries.push({ store, key, prev: await readPrev(store, key) })
		}
	}
	return entries
}

/** Siapkan record journal untuk sebuah blok (enumerasi + snapshot prev). */
export const prepareJournalRecord = async (
	block: Block,
): Promise<{ record: JournalRecord; touch: JournalTouchSet }> => {
	const touch = enumerateTouchSet(block)
	const entries = await capturePrev(touch)
	return {
		record: {
			height: block.block.height,
			hash: block.block.header.hash,
			entries,
		},
		touch,
	}
}

/** Tulis WAL (langkah 3): `sync:true` → ada di disk SEBELUM tulisan state. */
export const writeJournalRecord = async (
	record: JournalRecord,
): Promise<void> => {
	await rocksJournal.put(journalKey(record.height), record, { sync: true })
}

/**
 * Terapkan (rollback) satu record: pulihkan `prev`/del tiap kunci, LALU hapus
 * `journal:<h>`. Urutan "terapkan dulu baru hapus" membuat operasi idempoten
 * saat crash di tengah rollback.
 */
export const applyRecord = async (record: JournalRecord): Promise<void> => {
	for (const entry of record.entries) {
		const db = dbFor(entry.store)
		if (entry.prev === null) {
			await db.del(entry.key)
		} else {
			await db.put(entry.key, entry.prev as never)
		}
	}
	await rocksJournal.del(journalKey(record.height))
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
		await rollbackBlock(h)
		rolled++
	}
	return rolled
}

/**
 * Recovery saat boot (A.4): rollback record dengan `h > currentBlockHeight`,
 * lalu pangkas journal tua. Mengembalikan jumlah blok yang dibalik.
 */
export const recoverJournal = async (): Promise<number> => {
	const tip = await currentHeight()
	const rolled = await rollbackAbove(tip)
	if (rolled > 0) {
		logToConsole(
			`Journal recovery: ${rolled} blok tak-tuntas dibalik (tip=${tip}).`,
		)
	}
	await pruneJournal(tip)
	return rolled
}

/** Simpan `MAX_REORG_DEPTH` record terbaru; hapus sisanya. */
export const pruneJournal = async (tipHeight: number): Promise<number> => {
	if (tipHeight < 0) return 0
	const cutoff = tipHeight - MAX_REORG_DEPTH
	const heights = (await listJournalHeights()).filter((h) => h <= cutoff)
	for (const h of heights) {
		await rocksJournal.del(journalKey(h))
	}
	return heights.length
}
