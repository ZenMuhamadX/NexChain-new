/**
 * wallet-new UI gate: static checks for design and accessibility rules.
 * Run: bun run check:ui (from wallet-new/).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string): string => readFileSync(`${root}/${path}`, 'utf8')

const uiFiles = [
	'src/ui/main.tsx',
	'src/ui/App.tsx',
	'src/ui/screens.tsx',
	'src/ui/SecretReveal.tsx',
	'src/ui/sheets.tsx',
	'src/ui/Icon.tsx',
	'src/shell/explorer.ts',
	'src/ui/theme.css',
	'index.html',
	'public/manifest.json',
	'DESIGN.md',
]
const source = uiFiles.map(read).join('\n')
const css = read('src/ui/theme.css')
const html = read('index.html')
const manifest = read('public/manifest.json')
const sheets = read('src/ui/sheets.tsx')
const secretReveal = read('src/ui/SecretReveal.tsx')

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${label}`)
	} else {
		fail++
		console.log(`  FAIL ${label}`)
	}
}

ok('no em dash in UI source', !source.includes('\u2014'))
ok('outline is not disabled', !/outline:\s*none/.test(css))
ok('focus is visible via focus-visible', /:focus-visible\s*\{/.test(css))
ok(
	'focus-visible has an outline',
	/:focus-visible\s*\{[^}]*outline:/s.test(css),
)
ok(
	'reduced motion is respected',
	/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css),
)
ok('sheet closes on Escape', /event\.key === 'Escape'/.test(source))
ok('no <all_urls>', !source.includes('<all_urls>'))
ok(
	'no inline script in HTML',
	!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(html),
)
ok(
	'no inline event handlers in HTML',
	!/\son(click|change|load|error)\s*=/i.test(html),
)
ok(
	'UI does not import the old wallet',
	!/from ['"][^'"]*\/wallet\//.test(source),
)
ok(
	'Buffer polyfill is the first entry import',
	read('src/ui/main.tsx').startsWith("import './polyfill'"),
)

let unnamed = 0
for (const file of uiFiles.filter((name) => name.endsWith('.tsx'))) {
	const text = read(file)
	for (const match of text.matchAll(/<button\b[^>]*>/g)) {
		if (/aria-label=/.test(match[0])) continue
		const start = (match.index ?? 0) + match[0].length
		const after = text
			.slice(start, start + 400)
			.replace(/<[^>]*>/g, ' ')
			.replace(/\{[^}]*\}/g, ' ')
		if (!/[A-Za-z]/.test(after)) unnamed++
	}
}
ok('every button has an accessible name', unnamed === 0)

ok(
	'manifest does not request unrestricted origins',
	!manifest.includes('*://*/*') && !manifest.includes('<all_urls>'),
)
ok(
	'empty, loading, and failure states exist',
	['No activity for this address', 'Loading', 'Try again'].every((text) =>
		source.includes(text),
	),
)
ok(
	'send amount carries an NXC suffix',
	/amount-wrap/.test(sheets) && /input-suffix/.test(sheets),
)
ok(
	'review is a receipt with an automatic fee footer',
	/receipt-amount/.test(sheets) && /Network fee, auto/.test(sheets),
)
ok(
	'success check is animated',
	/stroke-dashoffset/.test(css) && /draw-check/.test(css),
)
ok(
	'UI copy is English',
	[
		'Belum ada aktivitas',
		'Konfirmasi dan kirim',
		'Simpan setelan',
		'Dompet untuk',
	].every((text) => !source.includes(text)),
)
ok(
	'secret reveal never touches the network, storage, clipboard, or logs',
	!/fetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|sendMessage|navigator\.clipboard|localStorage|sessionStorage|\bconsole\./.test(
		secretReveal,
	),
)
ok(
	'secret reveal offers no copy control',
	!/navigator\.clipboard|CopyButton|onCopy/.test(secretReveal),
)
ok('secrets require the passphrase again', /type="password"/.test(secretReveal))
ok(
	'secrets hide on a timer and when the tab hides',
	/AUTO_HIDE_MS/.test(secretReveal) &&
		/visibilitychange/.test(secretReveal) &&
		/Hide \$\{label\}/.test(secretReveal),
)
ok(
	'activity loads more pages on demand',
	source.includes('Load more') &&
		source.includes('onLoadMore') &&
		css.includes('.activity-footer'),
)
ok(
	'home has the account header and action tiles',
	source.includes('account-avatar') &&
		css.includes('.account-avatar') &&
		source.includes('action-tile') &&
		css.includes('.action-tile'),
)
ok(
	'home shows five recent activity rows',
	read('src/ui/screens.tsx').includes('Recent activity') &&
		read('src/ui/screens.tsx').includes('limit={5}') &&
		read('src/ui/App.tsx').includes('activity={activity}') &&
		!read('src/ui/App.tsx').includes('onOpenActivity'),
)
ok(
	'activity reload uses a refresh icon that spins on press',
	read('src/ui/Icon.tsx').includes("'refresh'") &&
		read('src/ui/Icon.tsx').includes('refresh-wheel') &&
		read('src/ui/screens.tsx').includes('name="refresh"') &&
		read('src/ui/screens.tsx').includes('refresh-spin') &&
		css.includes('.refresh-wheel') &&
		css.includes('.refresh-spin') &&
		read('src/ui/screens.tsx').includes('aria-label="Reload activity"'),
)
const explorer = read('src/shell/explorer.ts')
ok(
	'explorer deep links use the public default and the tx hash',
	explorer.includes("DEFAULT_EXPLORER_URL = 'https://explorer.zuns.my.id'") &&
		explorer.includes('/tx/${encodeURIComponent(hash)}') &&
		explorer.includes('VITE_EXPLORER_URL'),
)
ok(
	'every activity row links its txHash to /tx, pending included',
	read('src/ui/screens.tsx').includes(
		'explorerHref = tx.txHash ? explorerTxUrl(tx.txHash)',
	) &&
		!explorer.includes('explorerMempoolUrl') &&
		read('src/ui/screens.tsx').includes('className="activity-explorer"') &&
		css.includes('.activity-explorer'),
)
ok(
	'send uses a right arrow and received activity a left arrow',
	read('src/ui/Icon.tsx').includes(
		'send: <path d="M4 12h16M14 6l6 6-6 6" />',
	) &&
		read('src/ui/Icon.tsx').includes(
			'receive: <path d="M20 12H4M10 6l-6 6 6 6" />',
		),
)
ok(
	'explorer links open safely in a new tab',
	read('src/ui/screens.tsx').includes('rel="noopener noreferrer"') &&
		sheets.includes('rel="noopener noreferrer"'),
)
ok(
	'success view links the submitted tx hash',
	sheets.includes('href={explorerTxUrl(txHash)}') &&
		sheets.includes('View in Explorer') &&
		css.includes('.text-button'),
)
ok(
	'success check draws two strokes in sequence',
	(read('src/ui/Icon.tsx').match(/pathLength=\{1\}/g) ?? []).length === 2 &&
		css.includes('.done-mark svg path + path') &&
		css.includes('stroke-dasharray: 1') &&
		css.includes('animation: draw-check 260ms 160ms') &&
		css.includes('animation: draw-check 380ms 360ms'),
)
ok(
	'Settings can override the explorer URL',
	explorer.includes("STORAGE_KEY = 'wallet-new.explorer'") &&
		explorer.includes('persistExplorerUrl') &&
		read('src/ui/screens.tsx').includes('aria-label="Save explorer URL"'),
)
ok(
	'official brand kit is imported, not copied',
	['nexchain_blockchain_transparent.svg', 'nxc_ticker_transparent.svg'].every(
		(name) =>
			read('src/ui/screens.tsx').includes(name) &&
			existsSync(`${root}/../brand/asset/${name}`),
	),
)
ok(
	'asset-icon tile carries the ticker in the token row',
	/\.asset-icon\s*\{/.test(css) && /className="asset-icon"/.test(source),
)
ok(
	'popup asset URLs stay relative',
	!/["']\/brand\/|url\(\/brand\//.test(source),
)
ok(
	'receive QR uses the library at error correction H',
	/toDataURL\(/.test(sheets) &&
		sheets.includes("errorCorrectionLevel: 'H'") &&
		css.includes('.qr-image'),
)
ok(
	'receive is a full-screen NexChain view in English',
	sheets.includes('Receiving Address') &&
		sheets.includes('nxc_ticker_transparent.svg') &&
		css.includes('.receive-screen') &&
		!/Solana|Alamat Penerimaan|Salin|Tutup/.test(source),
)
ok(
	'receive slides up and keeps the wallet type scale',
	/\.receive-screen\s*\{[^}]*animation:\s*sheet-up/s.test(css) &&
		/\.receive-header h2\s*\{\s*margin:\s*0;\s*font-size:\s*19px/s.test(css) &&
		/\.receive-address\.mono\s*\{\s*font-size:\s*15px/s.test(css),
)
ok(
	'canvas is pure black and active tabs have no pill',
	css.includes('--canvas: #000000') &&
		!/\.nav-item\.is-active\s*\{[^}]*background/s.test(css),
)
ok(
	'nav icons fill, the clock ticks and the gear spins once',
	source.includes("'homeFilled'") &&
		css.includes('home-outline') &&
		css.includes('home-filled') &&
		css.includes('.clock-hands') &&
		css.includes('@keyframes clock-tick') &&
		!source.includes('M12 3.5v2m0 13v2') &&
		css.includes('gear-wheel') &&
		css.includes('@keyframes gear-spin') &&
		/\.nav-glyph\s*\{[^}]*width:\s*24px/s.test(css) &&
		/\.nav-item\.is-active \.nav-glyph\s*\{\s*color:\s*var\(--accent\)/s.test(
			css,
		),
)
ok(
	'action tiles use 24px icons and a QR glyph for receiving',
	source.includes('<Icon name="send" size={24} />') &&
		source.includes('<Icon name="qr" size={24} />') &&
		read('src/ui/Icon.tsx').includes("'qr'") &&
		!source.includes('<Icon name="receive" size={20} />'),
)
ok(
	'the top-right reload button is gone from Home',
	!source.includes('aria-label="Reload balance"'),
)
ok(
	'sheets slide down on close without scrolling the frame',
	/\.frame\s*\{[^}]*overflow:\s*clip/s.test(css) &&
		/\.sheet-layer\.is-closing\s*\{[^}]*pointer-events:\s*none/s.test(css) &&
		css.includes('.sheet-layer.is-closing .sheet') &&
		css.includes('.sheet-layer.is-closing .receive-screen') &&
		css.includes('.sheet-layer.is-closing .sheet-backdrop') &&
		css.includes('@keyframes sheet-down') &&
		css.includes('@keyframes fade-out') &&
		sheets.includes('useSheetExit') &&
		sheets.includes('onAnimationEnd={exit.finish}') &&
		!sheets.includes('onClick={onClose}') &&
		!sheets.includes("if (event.key === 'Escape') onClose()"),
)

console.log(`\n${pass} OK / ${fail} FAIL`)
if (fail > 0) process.exit(1)
