/**
 * Guard fail-closed undo journal.
 *
 * Selama sebuah blok sedang di-commit, journal "aktif" dan hanya boleh
 * menulis kunci yang **sudah terenumerasi** di touch-set blok itu. Menulis
 * kunci yang tidak terdaftar berarti enumerasi kita bocor: rollback tidak akan
 * bisa mengembalikannya, sehingga state bisa rusak tanpa terdeteksi. Karena
 * itu penulisan liar **dilempar** (bukan dicatat) dan commit dibatalkan.
 *
 * Modul ini SENGAJA daun (tanpa impor modul lain) supaya bisa dipakai oleh
 * penulis state/history/block mana pun tanpa siklus impor.
 */

export type JournalStoreName = 'state' | 'history' | 'block'

/** Himpunan kunci yang boleh ditulis untuk satu blok, dipisah per store. */
export interface JournalTouchSet {
	state: Set<string>
	history: Set<string>
	block: Set<string>
}

/**
 * Error khusus pelanggaran guard. Dibedakan dari error lain supaya catch
 * yang menelan error (per-transaksi, dsb.) bisa MELEMPAR-ulang error ini —
 * tanpa membedakannya, guard akan tertelan dan blok tetap ter-commit dengan
 * state yang tidak lengkap.
 */
export class JournalGuardError extends Error {
	constructor(store: JournalStoreName, key: string) {
		super(
			`Journal guard: tulisan tak terdaftar ${store}:${key} — commit ` +
				'dibatalkan (fail-closed). Lengkapi enumerasi touch-set.',
		)
		this.name = 'JournalGuardError'
	}
}

export const isJournalGuardError = (error: unknown): boolean =>
	error instanceof JournalGuardError ||
	(error instanceof Error && error.name === 'JournalGuardError')

let active: JournalTouchSet | null = null

/** Nyalakan guard untuk commit blok berikutnya. */
export const beginJournalContext = (touch: JournalTouchSet): void => {
	active = touch
}

/** Matikan guard (selalu dipanggil di `finally`). */
export const endJournalContext = (): void => {
	active = null
}

/** Apakah guard sedang aktif (untuk gate & diagnostik). */
export const isJournalActive = (): boolean => active !== null

/**
 * Izinkan `store:key` bila guard tidak aktif, atau bila kunci memang
 * terenumerasi. Selain itu lempar `JournalGuardError`.
 */
export const assertJournalAllows = (
	store: JournalStoreName,
	key: string,
): void => {
	if (!active) return
	if (!active[store].has(key)) throw new JournalGuardError(store, key)
}
