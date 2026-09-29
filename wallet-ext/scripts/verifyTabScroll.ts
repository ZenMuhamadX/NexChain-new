/**
 * Verifikasi scrollbar ganda di permukaan TAB (wallet.html).
 *
 * Pendekatan: load dist/wallet.html di headless Chrome, lalu suntikkan
 * struktur auth sesungguhnya (`.auth-shell > .auth-header + .auth-main`
 * dengan konten SANGAT tinggi) pakai class CSS NYATA dari entry.css.
 *
 * Yang diuji:
 *   1. Dokumen (html/body) TIDAK boleh menggulir — scrollHeight === clientHeight.
 *      Kalau body ikut membesar, ini akan BERBEDA → double scrollbar.
 *   2. `.auth-main` HARUS menggulir sendiri (scrollHeight > clientHeight).
 *   3. `.auth-shell` terkunci di tinggi viewport (≈ window height).
 *
 * Pemakaian:
 *   bun scripts/verifyTabScroll.ts
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const CHROME =
	process.env.CHROME_PATH ??
	'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.VERIFY_PORT ?? 4192)
const DEBUG_PORT = 9233
// Viewport sengaja rendah (600px) supaya kartu auth 2000px PASTI溢出 → memicu scroll.
const WIN_W = 900
const WIN_H = 600
const PROFILE = join(tmpdir(), 'nexchain-tab-scroll')

if (!existsSync(CHROME)) {
	console.error(`[tab] Chrome tidak ditemukan di ${CHROME}`)
	process.exit(1)
}

const sleep = (ms: number) =>
	new Promise((done) => setTimeout(done, ms))

const env = { ...process.env, NO_PROXY: '*', no_proxy: '*' }

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })

const server = spawn(
	'python',
	['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
	{ cwd: join(root, 'dist'), env, stdio: 'ignore' },
)

const chrome = spawn(
	CHROME,
	[
		'--headless=new',
		'--disable-gpu',
		'--no-sandbox',
		'--no-proxy-server',
		`--user-data-dir=${PROFILE}`,
		`--remote-debugging-port=${DEBUG_PORT}`,
		`--window-size=${WIN_W},${WIN_H}`,
		'about:blank',
	],
	{ stdio: 'ignore', env },
)

async function getTarget(): Promise<string | undefined> {
	for (let i = 0; i < 40; i += 1) {
		await sleep(300)
		try {
			const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
			const list = (await res.json()) as Array<{
				type?: string
				webSocketDebuggerUrl?: string
			}>
			const target = list.find(
				(t) => t.type === 'page' && t.webSocketDebuggerUrl,
			)
			if (target) return target.webSocketDebuggerUrl
		} catch {
			/* belum siap */
		}
	}
	return undefined
}

async function serverReady(): Promise<boolean> {
	for (let i = 0; i < 40; i += 1) {
		await sleep(200)
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/wallet.html`, {
				redirect: 'manual',
			})
			if (res.ok || res.status === 304) return true
		} catch {
			/* belum siap */
		}
	}
	return false
}

const TALL = 2000

async function main(): Promise<void> {
	if (!(await serverReady())) {
		console.error('[tab] Server statis dist/ tidak merespons.')
		process.exit(1)
	}

	const wsUrl = await getTarget()
	if (!wsUrl) {
		console.error('[tab] Tidak bisa menghubungkan ke Chrome CDP.')
		process.exit(1)
	}

	const ws = new WebSocket(wsUrl)
	let cmdId = 0
	const pending = new Map<number, (v: unknown) => void>()

	const send = (method: string, params: Record<string, unknown> = {}) =>
		new Promise<unknown>((resolve) => {
			const id = ++cmdId
			pending.set(id, resolve)
			ws.send(JSON.stringify({ id, method, params }))
		})

	await new Promise<void>((done) => {
		ws.onopen = () => done()
	})

	ws.onmessage = (ev) => {
		const msg = JSON.parse(ev.data.toString())
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)!(msg.result)
			pending.delete(msg.id)
		}
	}

	await send('Page.enable')
	await send('Runtime.enable')

	const nav = (await send('Page.navigate', {
		url: `http://127.0.0.1:${PORT}/wallet.html`,
	})) as { errorText?: string }
	if (nav?.errorText) {
		console.error('[tab] Navigasi gagal:', nav.errorText)
		process.exit(1)
	}

	let ready = false
	for (let i = 0; i < 20 && !ready; i += 1) {
		await sleep(400)
		const st = (await send('Runtime.evaluate', {
			expression: `document.readyState + '|' + (document.querySelector('link[rel=stylesheet]') ? 'css' : 'nocss')`,
			returnByValue: true,
		})) as { result?: { value?: string } }
		const val = st?.result?.value ?? ''
		if (val.startsWith('complete') && val.includes('css')) ready = true
	}
	if (!ready) {
		console.warn('[tab] Peringatan: halaman belum load penuh, ukur tetap dilanjutkan.')
	}

	// Suntikkan struktur auth NYATA dengan konten sangat tinggi.
	const inject = (await send('Runtime.evaluate', {
		expression: `(() => {
			const root = document.getElementById('root');
			root.innerHTML = \`
				<div class="auth-shell">
					<header class="auth-header"><div class="brand">NexChain Wallet</div></header>
					<main class="auth-main">
						<div style="height:${TALL}px;background:#eef">KARTU AUTH TINGGI</div>
					</main>
				</div>\`;
			return true;
		})()`,
		returnByValue: true,
	})) as { result?: { value?: boolean } }
	void inject

	const result = (await send('Runtime.evaluate', {
		expression: `(() => {
			const html = document.documentElement;
			const body = document.body;
			const shell = document.querySelector('.auth-shell');
			const main = document.querySelector('.auth-main');
			const cs = getComputedStyle(html);
			const bs = getComputedStyle(body);
			return JSON.stringify({
				htmlOverflow: cs.overflow + '/' + cs.overflowY,
				bodyOverflow: bs.overflow + '/' + bs.overflowY,
				htmlScrollable: html.scrollHeight - html.clientHeight,
				bodyScrollable: body.scrollHeight - body.clientHeight,
				docClientH: html.clientHeight,
				shellH: Math.round(shell.getBoundingClientRect().height),
				mainScrollable: main.scrollHeight - main.clientHeight,
				mainClientH: main.clientHeight,
			});
		})()`,
		returnByValue: true,
	})) as { result?: { value?: string } }

	const raw = result?.result?.value ?? '{}'
	const m = JSON.parse(raw) as Record<string, number | string>

	console.log('\n=== Measured (viewport ' + WIN_W + 'x' + WIN_H + ') ===')
	for (const [k, v] of Object.entries(m)) {
		console.log(`  ${k}: ${v}`)
	}

	const docLocked = m.htmlScrollable === 0 && m.bodyScrollable === 0
	const innerScrolls = (m.mainScrollable as number) > 0
	const shellBounded = Math.abs((m.shellH as number) - (m.docClientH as number)) <= 2

	console.log('\n=== Hasil ===')
	console.log(`  Dokumen TERKUNCI (html/body tdk scroll): ${docLocked ? 'YA ✓' : 'TIDAK ✗'}`)
	console.log(`  .auth-main menggulir sendiri         : ${innerScrolls ? 'YA ✓' : 'TIDAK ✗'}`)
	console.log(`  .auth-shell = tinggi viewport        : ${shellBounded ? 'YA ✓' : 'TIDAK ✗'}`)

	const pass = docLocked && innerScrolls && shellBounded
	console.log(`\n[tab] ${pass ? 'OK ✓ — double scrollbar TERATASI (scroll tunggal di dalam)' : 'GAGAL ✗ — masih ada scroll ganda / konten terpotong'}`)

	ws.close()
	process.exitCode = pass ? 0 : 1
}

try {
	await main()
} finally {
	server.kill()
	chrome.kill()
}
