/**
 * Event bus progres operasi kripto (PBKDF2) — jembatan worker → UI.
 *
 * Kenapa bus, bukan prop: operasi kripto dipanggil dari lapisan vault
 * (`vault.ts`) tanpa pengetahuan soal komponen mana yang menampilkan
 * progres, dan `WalletVault` adalah interface bersama Node/CLI yang tidak
 * boleh tahu soal UI. Komponen cukup subscribe; siapa pun boleh publish.
 *
 * `fraction` selalu 0..1 (1 = selesai).
 */
export interface CryptoProgressEvent {
	/** Tipe operasi worker: 'ENCRYPT_SECRET' | 'DECRYPT_SECRET' | ... */
	phase: string
	/** Fraksi penyelesaian 0..1. */
	fraction: number
}

type Listener = (event: CryptoProgressEvent) => void

const listeners = new Set<Listener>()

/** Sebarkan progres ke semua subscriber. Aman dipanggil dari mana pun. */
export const publishCryptoProgress = (event: CryptoProgressEvent): void => {
	for (const listener of listeners) listener(event)
}

/** Subscribe; kembalikan fungsi untuk berhenti. */
export const subscribeCryptoProgress = (listener: Listener): (() => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
