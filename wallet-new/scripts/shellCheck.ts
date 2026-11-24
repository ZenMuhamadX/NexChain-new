/**
 * wallet-new MV3 artifact gate. Run after `bun run build`.
 * Run: bun run check:shell (from wallet-new/).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const read = (path: string): string => readFileSync(path, 'utf8')

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${label}`)
	} else {
		fail++
		console.log(`  FAIL ${label}${extra ? `  -> ${extra}` : ''}`)
	}
}

const manifestPath = join(dist, 'manifest.json')
const htmlPath = join(dist, 'index.html')
ok('dist/manifest.json exists', existsSync(manifestPath))
ok('dist/index.html exists', existsSync(htmlPath))

if (!existsSync(manifestPath) || !existsSync(htmlPath)) {
	console.log('\nBuild first: bun run build')
	process.exit(1)
}

const manifest = JSON.parse(read(manifestPath)) as {
	manifest_version?: number
	action?: { default_popup?: string }
	host_permissions?: string[]
	optional_host_permissions?: string[]
	content_security_policy?: { extension_pages?: string }
}

ok('manifest_version is 3', manifest.manifest_version === 3)
ok('popup is index.html', manifest.action?.default_popup === 'index.html')
ok(
	'default host permission is localhost only',
	(manifest.host_permissions ?? []).every((value) =>
		/^http:\/\/(localhost|127\.0\.0\.1):8000\/\*$/.test(value),
	),
)
ok(
	'optional host permissions are http and https only',
	(manifest.optional_host_permissions ?? []).every((value) =>
		['http://*/*', 'https://*/*'].includes(value),
	),
)
ok('no <all_urls>', !read(manifestPath).includes('<all_urls>'))
ok(
	'extension_pages CSP is self only',
	manifest.content_security_policy?.extension_pages ===
		"script-src 'self'; object-src 'self'",
)

const html = read(htmlPath)
const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0])
ok(
	'one script tag from the build',
	scripts.length === 1,
	String(scripts.length),
)
ok(
	'script uses a local relative asset',
	scripts.every((tag) => /src="\.\/assets\/[^"]+\.js"/.test(tag)),
	scripts.join(' '),
)
ok('no inline script', !/<script(?![^>]*\bsrc=)[^>]*>/.test(html))
ok('no inline event handler', !/\son\w+\s*=/i.test(html))

const assets = readdirSync(join(dist, 'assets'))
const svgs = assets.filter((name) => name.endsWith('.svg'))
ok('both brand kit SVGs are emitted', svgs.length === 2, svgs.join(' '))
ok(
	'a JS bundle exists',
	assets.some((name) => name.endsWith('.js')),
)
ok(
	'a CSS bundle exists',
	assets.some((name) => name.endsWith('.css')),
)
ok(
	'no sourcemap',
	assets.every((name) => !name.endsWith('.map')),
)

const bundle = assets
	.filter((name) => name.endsWith('.js'))
	.map((name) => read(join(dist, 'assets', name)))
	.join('\n')
const styles = assets
	.filter((name) => name.endsWith('.css'))
	.map((name) => read(join(dist, 'assets', name)))
	.join('\n')
ok('bundle does not contain <all_urls>', !bundle.includes('<all_urls>'))
ok(
	'brand asset references stay relative',
	!bundle.includes('/brand/') && !styles.includes('url(/'),
)
ok(
	'bundle does not use absolute chrome-extension URLs',
	!bundle.includes('chrome-extension://'),
)

console.log(`\n${pass} OK / ${fail} FAIL`)
if (fail > 0) process.exit(1)
