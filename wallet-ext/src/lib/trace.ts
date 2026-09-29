/**
 * Pelacak boot SEMENTARA (diagnostik).
 *
 * Tujuan: menemukan TITIK MANA yang menggantung saat popup gagal menyiapkan
 * penyimpanan. Setiap langkah mencatat durasi + status ke console dengan
 * prefix `[nex-boot]` supaya bisa disalin langsung dari DevTools popup.
 *
 * HAPUS file ini (dan seluruh pemanggil `traceStep`/`traceNote`) setelah
 * akar masalah ditemukan.
 */

const START = Date.now()

/** Penanda waktu boot relatif terhadap pemuatan modul pertama. */
export const elapsed = (): string => `+${Date.now() - START}ms`

const log = (level: 'log' | 'warn' | 'error', line: string): void => {
	// eslint-disable-next-line no-console
	console[level](`[nex-boot] ${elapsed()} ${line}`)
}

/** Catatan bebas (tanpa pengukuran durasi). */
export const traceNote = (message: string, data?: unknown): void => {
	if (data === undefined) log('log', message)
	else log('log', `${message} ${safeStringify(data)}`)
}

export const traceWarn = (message: string, data?: unknown): void => {
	if (data === undefined) log('warn', `WARN ${message}`)
	else log('warn', `WARN ${message} ${safeStringify(data)}`)
}

/**
 * Bungkus operasi async dengan jejak mulai/selesai/gagal + durasi.
 *
 * Bila operasi menggantung, baris "GANTUNG" TIDAK akan pernah dicetak —
 * melainkan hanya baris "→ mulai". Itu sendiri sudah menunjuk lokasi hang.
 */
export const traceStep = async <T>(
	label: string,
	fn: () => Promise<T> | T,
): Promise<T> => {
	log('log', `→ ${label} … mulai`)
	currentStep = label
	const t0 = Date.now()
	try {
		const result = await fn()
		currentStep = undefined
		log('log', `✓ ${label} selesai (${Date.now() - t0}ms)`)
		return result
	} catch (error) {
		currentStep = undefined
		log(
			'error',
			`✗ ${label} GAGAL setelah ${Date.now() - t0}ms — ` +
				(error instanceof Error
					? `${error.name}: ${error.message}`
					: String(error)),
		)
		throw error
	}
}

/**
 * Langkah yang SEDANG berjalan (belum selesai). `undefined` = tidak ada.
 *
 * Dipakai failsafe: alih-alih menebak, ia bisa menyebut langkah mana yang
 * masih tertahan saat batas waktu tercapai.
 */
let currentStep: string | undefined

export const getCurrentStep = (): string | undefined => currentStep

/**
 * Dump semua langkah yang belum selesai + langkah aktif.
 * Dipanggil failsafe agar pesan galat menyebut titik hang yang pasti.
 */
export const describePendingStep = (): string =>
	currentStep ? `Langkah yang tertahan: "${currentStep}"` : 'Tidak ada langkah tertahan.'

const safeStringify = (value: unknown): string => {
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

/**
 * Bungkus promise dengan batas waktu keras.
 *
 * Berbeda dari `watch()` yang hanya MEMPERINGATKAN, fungsi ini benar-benar
 * MENOLAK promise setelah `ms`, sehingga `await` tidak pernah menggantung.
 * Dipakai di jalur boot: lebih baik menampilkan galat yang jelas daripada
 * splash berputar selamanya.
 */
export const withDeadline = <T>(
	label: string,
	promise: Promise<T>,
	ms: number,
): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			traceWarn(`BATAS WAKTU: "${label}" melewati ${ms}ms`)
			reject(
				new Error(
					`${label} tidak merespons dalam ${Math.round(ms / 1000)} detik.`,
				),
			)
		}, ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})

/** Pasang pembungkus "watchdog": bila promise tidak selesai dalam `ms`,
 * cetak peringatan berisi label. Tidak membatalkan apa pun — hanya
 * memberi tahu titik hang.
 */
export const watch = <T>(label: string, promise: Promise<T>, ms = 3000): Promise<T> => {
	const timer = setTimeout(() => {
		log('warn', `⚠ GANTUNG: "${label}" belum selesai setelah ${ms}ms`)
	}, ms)
	return promise.finally(() => clearTimeout(timer))
}

/** Laporan lingkungan awal — dicari pertama saat membuka console popup. */
export const traceEnvironment = (): void => {
	traceNote('=== DIAGNOSTIK BOOT NEXCHAIN WALLET ===')
	traceNote('URL konteks', typeof location !== 'undefined' ? location.href : 'n/a')
	traceNote('chrome.storage.local ada', hasChromeStorage())
	traceNote('chrome.runtime.id', safeRuntimeId())
	traceNote('localStorage bisa diakses', localStorageUsable())
	traceNote('crossOriginIsolated', (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false)
	traceNote('navigator.hardwareConcurrency', navigator?.hardwareConcurrency ?? 'n/a')

	/**
	 * PENENTU UTAMA: apakah `chrome.runtime.sendMessage` bisa dipanggil dari
	 * konteks ini?
	 *
	 * Bila endpoint penerima tidak ada (service worker belum aktif / gagal
	 * register / origin tidak punya akses), Chrome 116+ akan menolak promise
	 * ini dengan "Could not establish connection. Receiving end does not
	 * exist." — bukan menggantung. Itu membedakan dua hipotesis:
	 *   - PENOLAKAN cepat  → masalah di service worker / pesan.
	 *   - GANTUNG          → masalah di event loop / crash konteks.
	 */
	void probeRuntimeMessaging()
}

/** Uji `chrome.runtime.sendMessage` dengan timeout — lihat traceEnvironment. */
const probeRuntimeMessaging = async (ms = 4000): Promise<void> => {
	if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
		traceWarn('runtime.sendMessage TIDAK tersedia')
		return
	}
	const t0 = Date.now()
	try {
		const response = await Promise.race([
			chrome.runtime.sendMessage({ type: 'NEX_PING' }),
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error(`TIMEOUT ${ms}ms`)),
					ms,
				),
			),
		])
		traceNote(
			`runtime.sendMessage OK (${Date.now() - t0}ms)`,
			response,
		)
	} catch (error) {
		traceWarn(
			`runtime.sendMessage GAGAL setelah ${Date.now() - t0}ms`,
			error instanceof Error ? error.message : String(error),
		)
	}
}

const hasChromeStorage = (): boolean => {
	try {
		return typeof chrome !== 'undefined' && !!chrome.storage?.local
	} catch {
		return false
	}
}

const safeRuntimeId = (): string | undefined => {
	try {
		return typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined
	} catch {
		return undefined
	}
}

const localStorageUsable = (): boolean => {
	try {
		localStorage.setItem('__nex_probe', '1')
		localStorage.removeItem('__nex_probe')
		return true
	} catch {
		return false
	}
}

/**
 * Uji langsung `chrome.storage.local` dengan timeout pendek.
 * Ini langkah kunci: kalau ini menggantung, masalahnya di chrome.storage,
 * bukan di vault/worker.
 */
export const probeChromeStorage = async (ms = 3000): Promise<string> => {
	if (!hasChromeStorage()) return 'chrome.storage.local TIDAK tersedia'

	const area = chrome.storage.local
	const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
		Promise.race([
			p,
			new Promise<T>((_, reject) =>
				setTimeout(() => reject(new Error(`${label} TIMEOUT ${ms}ms`)), ms),
			),
		])

	try {
		const t0 = Date.now()
		await withTimeout(area.set({ __nex_probe: 'ok' }), 'set')
		const tSet = Date.now() - t0

		const t1 = Date.now()
		const got = await withTimeout(area.get('__nex_probe'), 'get')
		const tGet = Date.now() - t1

		await withTimeout(area.remove('__nex_probe'), 'remove')

		return `OK (set ${tSet}ms, get ${tGet}ms, nilai=${String(got?.__nex_probe)})`
	} catch (error) {
		return `GAGAL: ${error instanceof Error ? error.message : String(error)}`
	}
}

/**
 * Uji konstruksi + boot Web Worker kripto.
 * Worker gagal boot bila CSP `worker-src` ditolak atau bundel tak termuat.
 */
export const probeWorker = async (ms = 8000): Promise<string> => {
	try {
		const worker = new Worker(
			new URL('../workers/crypto.worker.ts', import.meta.url),
			{ type: 'module' },
		)
		const result = await new Promise<string>((resolve) => {
			const timer = setTimeout(() => {
				worker.terminate()
				resolve(`TIMEOUT ${ms}ms — tidak ada sinyal READY`)
			}, ms)
			worker.onmessage = (event: MessageEvent<{ type?: string }>) => {
				if (event.data?.type === 'READY') {
					clearTimeout(timer)
					worker.terminate()
					resolve('OK — sinyal READY diterima')
				}
			}
			worker.onerror = (err) => {
				clearTimeout(timer)
				worker.terminate()
				resolve(`ERROR: ${err.message}`)
			}
		})
		return result
	} catch (error) {
		return `GAGAL membuat Worker: ${
			error instanceof Error ? error.message : String(error)
		}`
	}
}
