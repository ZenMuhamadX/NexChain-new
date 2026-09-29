/**
 * Verifikasi ringan: apakah popup.html benar-benar mengunci html/body di
 * 360x600 terlepas dari style.css (yang memakai `height: 100%`).
 *
 * Kenapa CDP, bukan --dump-dom: kita butuh computed style, bukan markup.
 * React tak perlu mount — dimensi shell ditentukan inline <style> + entry.css.
 *
 * Pemakaian:
 *   bun scripts/verifyPopupSize.ts
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const CHROME =
	process.env.CHROME_PATH ??
	'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.VERIFY_PORT ?? 4191)
const DEBUG_PORT = 9222
const PROFILE = join(tmpdir(), 'nexchain-popup-size')

if (!existsSync(CHROME)) {
	console.error(`[size] Chrome tidak ditemukan di ${CHROME}`)
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
		`--window-size=900,900`,
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
			const res = await fetch(`http://127.0.0.1:${PORT}/popup.html`, {
				redirect: 'manual',
			})
			if (res.ok || res.status === 304) return true
		} catch {
			/* belum siap */
		}
	}
	return false
}

async function main(): Promise<void> {
	if (!(await serverReady())) {
		console.error('[size] Server statis dist/ tidak merespons.')
		process.exit(1)
	}

	const wsUrl = await getTarget()
	if (!wsUrl) {
		console.error('[size] Tidak bisa menghubungkan ke Chrome CDP.')
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
		url: `http://127.0.0.1:${PORT}/popup.html`,
	})) as { errorText?: string }
	if (nav?.errorText) {
		console.error('[size] Navigasi gagal:', nav.errorText)
		process.exit(1)
	}

	// Tunggu sampai document benar-benar load (CSS + inline style terpasang).
	let ready = false
	for (let i = 0; i < 20 && !ready; i += 1) {
		await sleep(400)
		const st = (await send('Runtime.evaluate', {
			expression: `document.readyState + '|' + location.href`,
			returnByValue: true,
		})) as { result?: { value?: string } }
		const val = st?.result?.value ?? ''
		if (val.startsWith('complete') && val.includes('popup.html')) ready = true
	}

	if (!ready) {
		console.warn('[size] Peringatan: halaman belum load penuh, ukur tetap dilanjutkan.')
	}

	const result = (await send('Runtime.evaluate', {
		expression: `(() => {
			const cs = getComputedStyle(document.documentElement);
			const b = getComputedStyle(document.body);
			const r = document.documentElement.getBoundingClientRect();
			return JSON.stringify({
				htmlWidth: cs.width,
				htmlHeight: cs.height,
				bodyWidth: b.width,
				bodyHeight: b.height,
				docRectW: Math.round(r.width),
				docRectH: Math.round(r.height),
			});
		})()`,
		returnByValue: true,
	})) as { result?: { value?: string } }

	const raw = result?.result?.value ?? '{}'
	const dims = JSON.parse(raw) as Record<string, string | number>

	console.log('\n=== Computed dimensi popup shell ===')
	for (const [k, v] of Object.entries(dims)) {
		console.log(`  ${k}: ${v}`)
	}

	const okW = dims.htmlWidth === '360px' && dims.htmlHeight === '600px'
	console.log(
		`\n[size] ${okW ? 'OK ✓' : 'GAGAL ✗'} — shell ${okW ? 'terkunci 360x600' : 'BUKAN 360x600 (terpotong?)'}`,
	)

	ws.close()
}

try {
	await main()
} finally {
	server.kill()
	chrome.kill()
}
