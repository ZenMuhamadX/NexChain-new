/**
 * Write-buffer commit — **satu-satunya sumber isi undo journal**.
 *
 * Selama commit, penulis state/history/block TIDAK menyentuh LevelDB. Mereka
 * menumpuk (kunci, nilai baru) di sini, dan nilai lama diambil sekali saat
 * kunci itu pertama disentuh. Setelah eksekusi selesai, isi buffer itulah
 * record journal — jadi tidak ada lagi enumerasi touch-set terpisah yang bisa
 * "bocor" dari tulisan sebenarnya.
 *
 * Urutan yang membuat crash aman:
 *
 *   eksekusi (RAM) → WAL `journal:<h>` sync → flush sync → `committed:<h>` sync
 *
 * Crash sebelum WAL: nol tulisan, tidak ada yang perlu dipulihkan. Crash
 * sesudah WAL (flush sebagian atau penuh): boot membalik memakai journal, dan
 * karena journal berasal dari tulisan itu sendiri, daftarnya selalu lengkap.
 * Blok baru dianggap permanen setelah `committed:<h>` tertulis.
 *
 * Di luar commit (genesis, rollback, gate) tulisan langsung ke DB: tidak ada
 * yang perlu di-undo, dan rollback butuh menulis langsung.
 */
import { rocksState } from 'src/core/state/db/state'
import { rocksHistory } from 'src/core/state/db/history'
import { rocksBlock } from 'src/core/state/db/block'
import { isNotFound } from 'src/core/state/db/notFound'
import type { StateLeaf } from 'src/core/state/root'
import type { Level } from 'level'

export type JournalStoreName = 'state' | 'history' | 'block'

/** Satu kunci yang disentuh blok, beserta nilai lamanya (untuk rollback). */
export interface JournalEntry {
	store: JournalStoreName
	key: string
	/** Nilai mentah sebelum commit; `null` = kunci belum ada → rollback = del. */
	prev: string | null
}

/** Record undo untuk satu blok: `journal:<height>`. */
export interface JournalRecord {
	height: number
	hash: string
	entries: JournalEntry[]
}

/** Urutan flush: badan blok dulu, state terakhir — lihat `flushWriteBuffer`. */
const STORES: readonly JournalStoreName[] = ['block', 'state', 'history']

export const dbFor = (store: JournalStoreName): Level<string, string> => {
	if (store === 'state') return rocksState as Level<string, string>
	if (store === 'history') return rocksHistory as Level<string, string>
	return rocksBlock as Level<string, string>
}

interface PendingWrite {
	prev: string | null
	value: string
}

/**
 * `commit`  — jalur commit blok: baca DB untuk nilai lama, boleh menulis
 *             mempool (tx yang masuk blok memang harus keluar dari mempool).
 * `simulate`— simulasi template: baca DB (state nyata) tetapi TIDAK boleh
 *             menyentuh mempool — template yang tak pernah ditambang tidak
 *             boleh menghapus transaksi pengguna.
 * `replay`  — replay dari genesis: state mulai KOSONG (tidak membaca DB sama
 *             sekali) dan mempool tidak disentuh. Buffer bertahan lintas blok
 *             selama replay; `bufferStateLeaves()` mengambil leaf per blok.
 */
export type BufferMode = 'commit' | 'simulate' | 'replay'

let active: Map<JournalStoreName, Map<string, PendingWrite>> | null = null
let mode: BufferMode = 'commit'
/** Alamat yang tertulis state sejak `bufferStateLeaves()` terakhir. */
let dirtyState = new Set<string>()

/**
 * Mulai menampung tulisan. Melempar bila dipanggil bersarang (bug pemanggil).
 */
export const beginWriteBuffer = (nextMode: BufferMode = 'commit'): void => {
	if (active) {
		throw new Error(
			'writeBuffer: begin dipanggil saat buffer masih aktif — commit bersarang?',
		)
	}
	mode = nextMode
	dirtyState = new Set()
	active = new Map(
		STORES.map((store) => [store, new Map<string, PendingWrite>()]),
	)
}

export const isWriteBufferActive = (): boolean => active !== null

/** Benar selama buffer hanya SIMULASI (template/replay) — bukan commit nyata. */
export const isSimulation = (): boolean => active !== null && mode !== 'commit'

/**
 * Buang seluruh isi buffer tanpa menulis apa pun (commit gagal / setelah
 * selesai). Selalu aman dipanggil, termasuk saat buffer tidak aktif.
 */
export const discardWriteBuffer = (): void => {
	active = null
	mode = 'commit'
	dirtyState = new Set()
}

/**
 * Kunci state yang BUKAN leaf akun: dua kunci metadata di store `state`.
 * Semua kunci lain adalah alamat (kunci = alamat, tidak ada prefix).
 */
export const isAccountStateKey = (key: string): boolean =>
	key !== 'blockState' && !key.startsWith('blockHeight:')

/**
 * Leaf akun yang berubah sejak panggilan terakhir, dengan nilai AKHIRNYA.
 * Inilah masukan `computeStateRoot`: blok hanya mengomit state yang ia sentuh.
 */
export const bufferStateLeaves = (): StateLeaf[] => {
	const map = active?.get('state')
	if (!map) return []
	const leaves: StateLeaf[] = []
	for (const address of dirtyState) {
		leaves.push({ address, value: map.get(address)!.value })
	}
	dirtyState = new Set()
	return leaves
}

/** Normalisasi nilai DB ke string|null (nilai non-string di-JSON-kan). */
const toPrev = (value: unknown): string | null => {
	if (value === undefined || value === null) return null
	if (typeof value === 'string') return value
	return JSON.stringify(value)
}

const readStored = async (
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

/**
 * Baca yang menghormati buffer: tulisan yang belum di-flush terlihat, jadi
 * beberapa transaksi dalam satu blok membaca saldo yang benar (bukan saldo
 * pra-blok). Tanpa ini tx kedua dari pengirim yang sama akan melihat saldo
 * lama dan lolos cek saldo padahal saldonya sudah terpakai.
 */
export const bufferGet = async (
	store: JournalStoreName,
	key: string,
): Promise<string | null> => {
	const pending = active?.get(store)?.get(key)
	if (pending) return pending.value
	// Replay: state dibangun dari nol, jadi kunci yang belum ditulis memang
	// belum ada — jangan pernah membaca state DB yang sedang diverifikasi.
	if (mode === 'replay') return null
	return readStored(store, key)
}

/**
 * Tulis: ke buffer bila commit aktif, langsung ke DB bila tidak.
 * `prev` diambil pada sentuhan pertama dan TIDAK ditimpa tulisan berikutnya —
 * rollback harus kembali ke nilai sebelum blok, bukan sebelum transaksi.
 */
export const bufferPut = async (
	store: JournalStoreName,
	key: string,
	value: string,
): Promise<void> => {
	if (!active) {
		await dbFor(store).put(key, value as never, { sync: true })
		return
	}
	const storeMap = active.get(store)!
	const existing = storeMap.get(key)
	if (existing) {
		existing.value = value
	} else {
		// Replay: nilai lama tidak dibaca (state dibangun dari nol).
		const prev = mode === 'replay' ? null : await readStored(store, key)
		storeMap.set(key, { prev, value })
	}
	if (store === 'state' && isAccountStateKey(key)) dirtyState.add(key)
}

/**
 * Tulis beberapa kunci sekaligus. Saat buffer aktif semuanya masuk buffer
 * (flush tetap satu batch per store); di luar commit dipakai `batch`
 * `sync:true` supaya pasangan yang tidak boleh berjauhan (mis.
 * `blockHeight:<h>` + `blockState`) tetap atomik di jalur bootstrap genesis.
 */
export const bufferBatch = async (
	store: JournalStoreName,
	ops: Array<{ key: string; value: string }>,
): Promise<void> => {
	if (!active) {
		await dbFor(store).batch(
			ops.map((op) => ({ type: 'put' as const, ...op })) as never,
			{ sync: true },
		)
		return
	}
	for (const op of ops) await bufferPut(store, op.key, op.value)
}

/** Salinan isi buffer sebagai entry journal (siap ditulis sebagai WAL). */
export const bufferEntries = (): JournalEntry[] => {
	const entries: JournalEntry[] = []
	for (const store of STORES) {
		for (const [key, write] of active?.get(store) ?? []) {
			entries.push({ store, key, prev: write.prev })
		}
	}
	return entries
}

/**
 * Seluruh tulisan state di buffer (kunci → nilai akhir). Dipakai diff replay:
 * state hasil replay dibandingkan dengan isi DB, bukan hanya root header.
 */
export const bufferStateMap = (): Map<string, string> => {
	const out = new Map<string, string>()
	for (const [key, write] of active?.get('state') ?? []) {
		if (isAccountStateKey(key)) out.set(key, write.value)
	}
	return out
}

/**
 * Terapkan buffer ke DB, satu batch `sync:true` per store.
 *
 * Batch per store (bukan satu batch lintas store) karena LevelDB terpisah per
 * store: itu batas atomik yang tersedia. Urutannya badan blok dulu supaya
 * batch state tidak pernah menyebut badan yang belum ada; arah sebaliknya
 * (badan yatim) tidak berbahaya dan journal menutup keduanya.
 */
export const flushWriteBuffer = async (): Promise<void> => {
	if (!active) {
		throw new Error('writeBuffer: flush tanpa commit aktif')
	}
	for (const store of STORES) {
		const ops = [...active.get(store)!].map(([key, write]) => ({
			type: 'put' as const,
			key,
			value: write.value,
		}))
		if (ops.length > 0) {
			await dbFor(store).batch(ops as never, { sync: true })
		}
	}
}
