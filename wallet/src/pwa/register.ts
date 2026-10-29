import { registerSW } from 'virtual:pwa-register'
import { installPlatform } from '../lib/platform'
import type {
	InstallHint,
	PersistenceState,
	PlatformBridge,
	PlatformState,
} from '../lib/platform'

/**
 * Runtime PWA untuk shell web.
 *
 * Satu-satunya modul yang menyentuh `virtual:pwa-register`. Dipisahkan dari
 * shell supaya `main.tsx` tetap terbaca sebagai urutan boot, dan supaya build
 * desktop/dev tidak pernah membundel modul virtual ini.
 *
 * Tiga tanggung jawab:
 *   1. Mendaftarkan service worker (mode `prompt` — TIDAK pernah auto-reload).
 *   2. Menyediakan prompt pemasangan (`beforeinstallprompt`) dan menerjemahkan
 *      cara pemasangan yang benar untuk perangkat ini (iOS ≠ Android ≠ menu).
 *   3. Melaporkan status penyimpanan persisten — satu-satunya jaminan (tipis)
 *      bahwa browser tidak membuang vault terenkripsi saat ruang menipis.
 *
 * Yang TIDAK dilakukan di sini: menyimpan mnemonic, kunci, atau transaksi.
 * Semua status di bawah ini murni presentasi.
 */

/** `beforeinstallprompt` belum ada di lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

/**
 * Jeda minimum antar pemeriksaan versi baru saat aplikasi kembali terlihat.
 *
 * Dua alasan: (a) `registration.update()` memanggil jaringan, dan wallet bisa
 * dibuka-tutup puluhan kali sehari; (b) tanpa jeda, membuka aplikasi akan
 * memunculkan banner update terus-menerus pada deploy yang sama.
 */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000

const isIos = (): boolean => {
	const ua = navigator.userAgent
	if (/iPad|iPhone|iPod/.test(ua)) return true
	// iPadOS 13+ menyamar sebagai macOS; sentuhan yang membedakannya.
	return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

const isStandalone = (): boolean => {
	if (window.matchMedia?.('(display-mode: standalone)').matches) return true
	// Safari iOS memakai properti non-standar ini, bukan display-mode.
	return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * Pasang jembatan platform PWA. Panggil SEKALI, sebelum render pertama.
 */
export const installWebPlatform = (): void => {
	/** Event `beforeinstallprompt` yang ditahan supaya bisa dipicu dari tombol. */
	let deferredPrompt: BeforeInstallPromptEvent | undefined
	let registration: ServiceWorkerRegistration | undefined
	let lastCheckAt = 0

	let state: PlatformState = {
		supported: true,
		standalone: isStandalone(),
		secure: window.isSecureContext,
		installHint: 'menu',
		updateAvailable: false,
		persistence: 'unknown',
		version: __APP_VERSION__,
	}

	const listeners = new Set<(next: PlatformState) => void>()

	/** Ubah status; abaikan bila tidak ada field yang benar-benar berubah. */
	const emit = (patch: Partial<PlatformState>): void => {
		const changed = (Object.keys(patch) as (keyof PlatformState)[]).some(
			(key) => state[key] !== patch[key],
		)
		if (!changed) return
		state = { ...state, ...patch }
		for (const listener of listeners) listener(state)
	}

	/**
	 * Cara pemasangan yang benar untuk perangkat ini.
	 *
	 * iOS sengaja didahulukan sebelum `prompt`: Safari tidak pernah memicu
	 * `beforeinstallprompt`, jadi tanpa cabang ini iPhone akan disuruh membuka
	 * menu browser yang tidak punya item "Instal".
	 */
	const computeHint = (): InstallHint => {
		if (isStandalone()) return 'installed'
		if (deferredPrompt) return 'prompt'
		if (isIos()) return 'ios'
		return 'menu'
	}

	const readPersistence = async (): Promise<PersistenceState> => {
		const storage = navigator.storage
		if (!storage || typeof storage.persisted !== 'function')
			return 'unsupported'
		try {
			return (await storage.persisted()) ? 'persisted' : 'best-effort'
		} catch {
			return 'unsupported'
		}
	}

	const refreshPersistence = (): void => {
		void readPersistence().then((persistence) => emit({ persistence }))
	}

	/**
	 * Cek versi baru — TANPA memaksa aktivasi.
	 *
	 * `registration.update()` hanya mengunduh SW baru; SW itu berhenti di status
	 * *waiting* dan Workbox memicu `waiting` → `onNeedRefresh` → banner. Ini
	 * berbeda dari `updateSW()` milik plugin, yang mengirim `skipWaiting` dan
	 * memuat ulang halaman — itu hanya boleh dari klik user.
	 */
	const maybeCheckUpdate = (): void => {
		if (!registration) return
		const now = Date.now()
		if (now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return
		lastCheckAt = now
		registration.update().catch(() => {
			// Offline / server baru: bukan kegagalan yang perlu ditampilkan.
		})
	}

	const updateServiceWorker = registerSW({
		immediate: true,
		onNeedRefresh: () => emit({ updateAvailable: true }),
		onRegisteredSW: (_swUrl, reg) => {
			registration = reg
			lastCheckAt = Date.now()
		},
		onRegisterError: (error) => {
			console.warn('[pwa] pendaftaran service worker gagal:', error)
		},
	})

	// ── Pemasangan ────────────────────────────────────────────────────────────
	window.addEventListener('beforeinstallprompt', (event) => {
		// Tanpa preventDefault, Chrome menampilkan prompt-nya sendiri dan event
		// ini tidak bisa dipakai lagi — kita kehilangan tombol "Pasang".
		event.preventDefault()
		deferredPrompt = event as BeforeInstallPromptEvent
		emit({ installHint: computeHint() })
	})

	window.addEventListener('appinstalled', () => {
		deferredPrompt = undefined
		emit({ installHint: computeHint() })
	})

	// ── Mode tampilan (tab ↔ aplikasi terpasang) ──────────────────────────────
	const displayMode = window.matchMedia?.('(display-mode: standalone)')
	displayMode?.addEventListener?.('change', () => {
		emit({ standalone: isStandalone(), installHint: computeHint() })
	})

	// ── Siklus hidup ──────────────────────────────────────────────────────────
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible') return
		refreshPersistence()
		maybeCheckUpdate()
	})

	refreshPersistence()
	emit({ installHint: computeHint() })

	const bridge: PlatformBridge = {
		state: () => state,
		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		requestInstall: async () => {
			const event = deferredPrompt
			if (!event) return false
			// Event hanya boleh dipakai sekali — buang dulu supaya tombol tidak
			// bisa memicu prompt basi bila user menekannya dua kali.
			deferredPrompt = undefined
			try {
				await event.prompt()
				const choice = await event.userChoice
				return choice.outcome === 'accepted'
			} catch {
				return false
			} finally {
				emit({ installHint: computeHint() })
			}
		},
		requestPersistence: async () => {
			const storage = navigator.storage
			if (!storage || typeof storage.persist !== 'function') {
				emit({ persistence: 'unsupported' })
				return
			}
			try {
				await storage.persist()
			} catch {
				// Ditolak / tidak didukung — status akhir tetap dibaca di bawah.
			}
			emit({ persistence: await readPersistence() })
		},
		applyUpdate: () => {
			// Satu-satunya jalan yang memuat ulang halaman. Sengaja tidak dipanggil
			// otomatis: reload saat transaksi berjalan tidak bisa diterima.
			void updateServiceWorker(true)
		},
	}

	installPlatform(bridge)
}
