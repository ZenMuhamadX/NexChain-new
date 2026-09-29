/**
 * Ambient types untuk konteks Chrome Extension MV3.
 *
 * Kenapa perlu: lib DOM mendeklarasikan `self` sebagai
 * `Window & typeof globalThis`, sehingga `self.skipWaiting()` / `self.clients`
 * di service worker tidak dikenali TypeScript. Kita perluas tipe global
 * `Window` dengan anggota service worker yang benar-benar dipakai.
 *
 * Catatan: deklarasi ini tidak "mengubah" runtime; hanya memberi tahu
 * typechecker bahwa simbol ini valid di konteks service worker.
 */

interface Window {
	/** Service worker MV3: aktifkan segera tanpa menunggu reload tab. */
	skipWaiting?: () => Promise<void>
	/** Service worker MV3: daftar window/client yang dikendalikan. */
	clients?: {
		claim: () => Promise<void>
	}
}

interface ExtendableEvent extends Event {
	waitUntil(promise: Promise<unknown>): void
}
