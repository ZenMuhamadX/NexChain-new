import { Level } from 'level'
import { initFile } from './init'
import { dataPath } from './dataDir'

initFile()

/**
 * Satu-satunya LevelDB node. Store lama (block/history/state/journal/mempool/
 * storeData) kini menjadi VIEW dengan prefix key di database yang SAMA, supaya
 * satu `batch` bisa mencakup semua store sekaligus.
 *
 * View mengupas prefix saat baca/iterasi, jadi kunci yang terlihat pemanggil
 * persis sama seperti sebelum migrasi — tidak ada kode pemanggil yang perlu
 * tahu soal namespace.
 */
const db = new Level<string, string>(dataPath('chain'), {
	valueEncoding: 'utf-8',
	keyEncoding: 'utf-8',
	cacheSize: 16 * 1024 * 1024,
	writeBufferSize: 16 * 1024 * 1024,
	blockSize: 16384,
	compression: false,
	createIfMissing: true,
	errorIfExists: false,
	maxOpenFiles: 2048,
	maxFileSize: 1024 * 1024 * 1024,
	blockRestartInterval: 16,
	multithreading: false,
})

interface Codec {
	encode: (value: unknown) => string
	decode: (value: string) => unknown
}

/** Sama dengan `valueEncoding` lama tiap store. */
const utf8: Codec = {
	encode: (value) => value as string,
	decode: (value) => value,
}
const json: Codec = {
	encode: (value) => JSON.stringify(value),
	decode: (value) => JSON.parse(value),
}

export interface DbRange {
	gte?: string
	gt?: string
	lte?: string
	lt?: string
	reverse?: boolean
	limit?: number
	keys?: boolean
	values?: boolean
	fillCache?: boolean
}

export interface DbOp {
	type: 'put' | 'del'
	key: string
	value?: unknown
}

export interface DbView {
	get(key: string, opts?: { fillCache?: boolean }): Promise<unknown>
	put(key: string, value: unknown, opts?: { sync?: boolean }): Promise<void>
	del(key: string, opts?: { sync?: boolean }): Promise<void>
	batch(ops: readonly DbOp[], opts?: { sync?: boolean }): Promise<void>
	iterator(range?: DbRange): AsyncIterableIterator<[string, unknown]>
	keys(range?: DbRange): AsyncIterableIterator<string>
	open(): Promise<void>
	close(): Promise<void>
}

const makeView = (prefix: string, codec: Codec): DbView => {
	const full = (key: string): string => `${prefix}${key}`
	/** Karakter tepat setelah prefix — batas atas untuk scan seluruh namespace. */
	const upper =
		prefix.slice(0, -1) +
		String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)

	const scope = (range: DbRange = {}): DbRange => {
		const out: DbRange = { ...range }
		if (range.gte !== undefined) out.gte = full(range.gte)
		else if (range.gt === undefined) out.gte = prefix
		if (range.lte !== undefined) out.lte = full(range.lte)
		if (range.lt !== undefined) out.lt = full(range.lt)
		else if (range.lte === undefined) out.lt = upper
		return out
	}

	return {
		async get(key, opts) {
			const value = await db.get(full(key), opts as never)
			return value === undefined ? undefined : codec.decode(value as string)
		},
		async put(key, value, opts) {
			await db.put(full(key), codec.encode(value), opts as never)
		},
		async del(key, opts) {
			await db.del(full(key), opts as never)
		},
		async batch(ops, opts) {
			await db.batch(
				ops.map((op) =>
					op.type === 'put'
						? {
								type: 'put' as const,
								key: full(op.key),
								value: codec.encode(op.value),
							}
						: { type: 'del' as const, key: full(op.key) },
				),
				opts as never,
			)
		},
		async *iterator(range) {
			for await (const [key, value] of db.iterator(scope(range) as never)) {
				yield [
					String(key).slice(prefix.length),
					value === undefined ? undefined : codec.decode(value as string),
				]
			}
		},
		async *keys(range) {
			for await (const key of db.keys(scope(range) as never)) {
				yield String(key).slice(prefix.length)
			}
		},
		open: () => db.open(),
		close: () => db.close(),
	}
}

export const rocksBlock = makeView('b!', utf8)
export const rocksState = makeView('s!', json)
export const rocksHistory = makeView('h!', utf8)
export const rocksJournal = makeView('j!', json)
export const rocksMempool = makeView('m!', json)
