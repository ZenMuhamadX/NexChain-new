/**
 * Halaman diagnostik yang berjalan DI DALAM extension asli.
 *
 * KENAPA INI PERLU
 *   Harness `preview.html` memuat markup tiruan, dan `diagnosePopup.ts`
 *   memuat `dist/popup.html` sebagai halaman HTTP biasa — di sana `chrome.*`
 *   TIDAK ADA, sehingga semua pemeriksaan storage hanya melihat fallback
 *   localStorage dan selalu tampak "sehat". Bug nyata hanya muncul di
 *   konteks `chrome-extension://`.
 *
 *   Halaman ini dijalankan sebagai bagian dari extension, jadi
 *   `chrome.storage`, `chrome.runtime`, dan service worker semuanya nyata.
 *
 * CARA PAKAI
 *   1. `bun run build`
 *   2. chrome://extensions → Reload extension
 *   3. Klik "periksa tampilan" / Details → buka
 *      chrome-extension://<ID>/diagnostics.html
 *      (atau: klik ikon extension → tombol "Buka di tab" lalu ganti URL)
 *   4. Kirim isi kotak "Salinan hasil".
 *
 * HAPUS halaman ini bersama `src/lib/trace.ts` setelah masalah selesai.
 */

interface Result {
	label: string
	status: 'ok' | 'bad' | 'warn'
	detail: string
}

const results: Result[] = []
const env: Array<[string, string]> = []

const add = (label: string, status: Result['status'], detail: string): void => {
	results.push({ label, status, detail })
}

const setEnv = (label: string, value: unknown): void => {
	env.push([label, value === undefined ? '(undefined)' : String(value)])
}

/** Jalankan promise dengan batas waktu keras. */
const deadline = async <T>(
	label: string,
	promise: Promise<T>,
	ms: number,
): Promise<T> =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`TIMEOUT ${ms}ms`)),
			ms,
		)
		promise.then(
			(v) => {
				clearTimeout(timer)
				resolve(v)
			},
			(e) => {
				clearTimeout(timer)
				reject(e)
			},
		)
	})

const describe = (error: unknown): string =>
	error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error)

// ---- 1. Lingkungan ----
setEnv('URL', location.href)
setEnv('origin', location.origin)
setEnv('protocol', location.protocol)
setEnv('chrome ada', typeof chrome !== 'undefined')
setEnv('chrome.runtime.id', (() => {
	try {
		return typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined
	} catch {
		return '(akses melempar)'
	}
})())
setEnv('chrome.storage ada', (() => {
	try {
		return typeof chrome !== 'undefined' && !!chrome.storage
	} catch {
		return false
	}
})())
setEnv('chrome.storage.local ada', (() => {
	try {
		return typeof chrome !== 'undefined' && !!chrome.storage?.local
	} catch {
		return false
	}
})())
setEnv('manifest version', (() => {
	try {
		return chrome.runtime?.getManifest?.().version
	} catch {
		return undefined
	}
})())
setEnv('isSecureContext', window.isSecureContext)
setEnv('crypto.subtle ada', !!globalThis.crypto?.subtle)

// ---- 2. Uji ----

// 2a. chrome.storage.local — set/get/remove
const testStorage = async (): Promise<void> => {
	try {
		if (typeof chrome === 'undefined' || !chrome.storage?.local) {
			add('chrome.storage.local', 'bad', 'TIDAK tersedia di konteks ini')
			return
		}
		const t0 = Date.now()
		await deadline(
			'storage.set',
			chrome.storage.local.set({ __nex_diag: 'ok' }),
			3000,
		)
		const t1 = Date.now()
		const got = (await deadline(
			'storage.get',
			chrome.storage.local.get('__nex_diag'),
			3000,
		)) as Record<string, unknown>
		const t2 = Date.now()
		await deadline(
			'storage.remove',
			chrome.storage.local.remove('__nex_diag'),
			3000,
		)
		add(
			'chrome.storage.local',
			'ok',
			`set ${t1 - t0}ms · get ${t2 - t1}ms · nilai=${String(got.__nex_diag)}`,
		)
	} catch (error) {
		add('chrome.storage.local', 'bad', describe(error))
	}
}

// 2b. service worker — round-trip NEX_PING
const testServiceWorker = async (): Promise<void> => {
	try {
		if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
			add('service worker (NEX_PING)', 'bad', 'runtime.sendMessage tidak ada')
			return
		}
		const t0 = Date.now()
		const response = await deadline(
			'NEX_PING',
			chrome.runtime.sendMessage({ type: 'NEX_PING' }),
			5000,
		)
		add(
			'service worker (NEX_PING)',
			'ok',
			`balas dalam ${Date.now() - t0}ms → ${JSON.stringify(response)}`,
		)
	} catch (error) {
		add('service worker (NEX_PING)', 'bad', describe(error))
	}
}

// 2c. Web Worker kripto
const testCryptoWorker = async (): Promise<void> => {
	try {
		const worker = new Worker(
			new URL('../workers/crypto.worker.ts', import.meta.url),
			{ type: 'module' },
		)
		const t0 = Date.now()
		const outcome = await new Promise<string>((resolve) => {
			const timer = setTimeout(() => {
				worker.terminate()
				resolve('TIMEOUT — tidak ada sinyal READY')
			}, 8000)
			worker.onmessage = (event: MessageEvent<{ type?: string }>) => {
				if (event.data?.type === 'READY') {
					clearTimeout(timer)
					worker.terminate()
					resolve(`READY dalam ${Date.now() - t0}ms`)
				}
			}
			worker.onerror = (err) => {
				clearTimeout(timer)
				worker.terminate()
				resolve(`onerror: ${err.message}`)
			}
		})
		add('Web Worker kripto', outcome.startsWith('READY') ? 'ok' : 'bad', outcome)
	} catch (error) {
		add('Web Worker kripto', 'bad', describe(error))
	}
}

// 2d. localStorage
const testLocalStorage = (): void => {
	try {
		localStorage.setItem('__nex_diag', '1')
		localStorage.removeItem('__nex_diag')
		add('localStorage', 'ok', 'bisa dibaca/tulis')
	} catch (error) {
		add('localStorage', 'bad', describe(error))
	}
}

// 2e. vault (KESELURUHAN) — inti dari masalah ini
const testVault = async (): Promise<void> => {
	try {
		const { getVault } = await import('../lib/vault')
		const t0 = Date.now()
		const vault = await deadline('getVault', getVault(), 10_000)
		const t1 = Date.now()
		const has = await deadline('hasWallet', vault.hasWallet(), 5_000)
		const t2 = Date.now()
		add(
			'vault lengkap',
			'ok',
			`getVault ${t1 - t0}ms · hasWallet ${t2 - t1}ms · punya wallet=${has}`,
		)
	} catch (error) {
		add('vault lengkap', 'bad', describe(error))
	}
}

// 2f. CSP aktif — apakah `connect-src` mengizinkan host eksternal?
//
// CARA KERJA: fetch ke origin yang PASTI bukan 'self' (mis. http://10.255.255.1
// yang tidak akan pernah menjawab). Bila CSP memblokir, error-nya berupa
// TypeError tanpa network — dan itu terbaca. Bila CSP mengizinkan, errornya
// adalah kegagalan jaringan/timeout (yang memang diharapkan).
//
// Tujuannya bukan "berhasil konek", tapi MEMBEDAKAN dua jenis kegagalan.
const testCsp = async (): Promise<void> => {
	const probe = 'http://10.255.255.1/__csp_probe'
	try {
		await deadline('csp probe', fetch(probe, { mode: 'no-cors' }), 2_500)
		add('CSP connect-src (probe)', 'warn', 'lolos tanpa error (tidak terduga)')
	} catch (error) {
		const msg = describe(error)
		// CSP memblokir → pesan menyebut "Content Security Policy"/"Refused".
		// Kalau hanya timeout, berarti CSP MENGIZINKAN dan ini murni jaringan.
		if (/Content Security Policy|Refused to connect|violates/i.test(msg)) {
			add(
				'CSP connect-src (probe)',
				'bad',
				`CSP MEMBLOKIR host eksternal → ${msg}`,
			)
		} else if (/TIMEOUT/i.test(msg)) {
			add(
				'CSP connect-src (probe)',
				'ok',
				'CSP MENGIZINKAN host eksternal (timeout = wajar, host memang mati)',
			)
		} else {
			add('CSP connect-src (probe)', 'warn', `kegagalan lain → ${msg}`)
		}
	}
}

// 2g. fetch ke URL RPC YANG DIKONFIGURASI user (bukan localhost hardcoded).
const testConfiguredRpc = async (): Promise<void> => {
	let url = ''
	try {
		const stored = await chrome.storage.local.get('nex_rpc_url')
		url = typeof stored.nex_rpc_url === 'string' ? stored.nex_rpc_url : ''
	} catch {
		/* storage tidak tersedia */
	}
	if (!url) url = 'http://localhost:8000/rpc'

	add('URL RPC terkonfigurasi', 'warn', url)

	try {
		const t0 = Date.now()
		const response = await deadline(
			'fetch RPC terkonfigurasi',
			fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'nex_getChainId',
				}),
			}),
			8_000,
		)
		const body = await response.text()
		add(
			'fetch RPC terkonfigurasi',
			'ok',
			`HTTP ${response.status} dalam ${Date.now() - t0}ms → ${body.slice(0, 120)}`,
		)
	} catch (error) {
		const msg = describe(error)
		if (/Content Security Policy|Refused to connect|violates/i.test(msg)) {
			add('fetch RPC terkonfigurasi', 'bad', `CSP BLOKIR → ${msg}`)
		} else {
			add(
				'fetch RPC terkonfigurasi',
				'bad',
				`${msg} (bukan CSP — cek node/jaringan)`,
			)
		}
	}
}


// ---- Render ----
const render = (): void => {
	const envTable = document.getElementById('env')!
	envTable.innerHTML = env
		.map(
			([k, v]) =>
				`<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
		)
		.join('')

	const testTable = document.getElementById('tests')!
	testTable.innerHTML = results
		.map((r) => {
			const cls = r.status === 'ok' ? 'ok' : r.status === 'bad' ? 'bad' : 'warn'
			const mark = r.status === 'ok' ? '✓' : r.status === 'bad' ? '✗' : '⚠'
			return `<tr><td class="${cls}">${mark} ${escapeHtml(r.label)}</td><td>${escapeHtml(r.detail)}</td></tr>`
		})
		.join('')

	const lines: string[] = []
	lines.push('=== LINGKUNGAN ===')
	for (const [k, v] of env) lines.push(`${k}: ${v}`)
	lines.push('')
	lines.push('=== HASIL UJI ===')
	for (const r of results) {
		const mark = r.status === 'ok' ? 'OK  ' : r.status === 'bad' ? 'GAGAL' : 'WARN '
		lines.push(`[${mark}] ${r.label} — ${r.detail}`)
	}
	const failures = results.filter((r) => r.status === 'bad')
	lines.push('')
	lines.push(
		failures.length === 0
			? 'KESIMPULAN: semua lapisan responsif.'
			: `KESIMPULAN: ${failures.length} uji GAGAL → ${failures.map((f) => f.label).join(', ')}`,
	)
	document.getElementById('dump')!.textContent = lines.join('\n')

	// Marker untuk pembacaan otomatis (--dump-dom).
	const marker = document.createElement('script')
	marker.id = 'diag-result'
	marker.type = 'application/json'
	marker.textContent = JSON.stringify({ env, results })
	document.head.appendChild(marker)
}

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')

document.getElementById('copy')?.addEventListener('click', () => {
	const text = document.getElementById('dump')!.textContent ?? ''
	void navigator.clipboard?.writeText(text)
})

// Urutan penting: yang paling mungkin gagal dijalankan lebih dulu.
void (async () => {
	await testStorage()
	await testServiceWorker()
	await testCryptoWorker()
	testLocalStorage()
	await testVault()
	await testCsp()
	await testConfiguredRpc()
	render()
})()

export {}
