/**
 * WCAG 2.2 AA contrast checker — membaca token langsung dari src/style.css
 * (blok `:root` = light, `[data-theme="dark"]` = dark), lalu memverifikasi
 * pasangan foreground/background yang benar-benar dipakai di UI.
 *
 * Jalankan dari folder explorer/:
 *     npm run a11y      (atau: node scripts/contrast-check.mjs)
 *
 * Kenapa token-based: begitu seseorang mengubah --ok / --bg-subtle di CSS,
 * check ini merah sebelum sampai ke user. Angka 2.96:1 (badge confirmed)
 * yang dulu lolos tidak akan bisa balik tanpa ketahuan.
 *
 * Also reports the type-scale / spacing budgets (Fase 0 acceptance).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src', 'style.css'), 'utf8')

/* ---------- ambil blok selector (dari css tanpa komentar) ---------- */
const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
const blockOf = (selector) => {
	const at = src.indexOf(selector)
	if (at < 0) throw new Error(`selector tidak ditemukan: ${selector}`)
	const open = src.indexOf('{', at)
	let depth = 0
	for (let i = open; i < src.length; i += 1) {
		if (src[i] === '{') depth += 1
		else if (src[i] === '}') {
			depth -= 1
			if (depth === 0) return src.slice(open + 1, i)
		}
	}
	throw new Error(`blok tidak tertutup: ${selector}`)
}

const tokensOf = (body) => {
	const out = new Map()
	for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		out.set(m[1], m[2].trim())
	}
	return out
}

const resolve = (tokens, name, seen = new Set()) => {
	if (seen.has(name)) throw new Error(`siklus var: ${name}`)
	seen.add(name)
	const raw = tokens.get(name)
	if (raw === undefined) throw new Error(`token tidak didefinisikan: ${name}`)
	const v = raw.trim()
	const varRef = /^var\((--[\w-]+)\)$/.exec(v)
	return varRef ? resolve(tokens, varRef[1], seen) : v
}

/* ---------- WCAG luminance / contrast ---------- */
const toRgb = (hex) => {
	const h = hex.trim().replace('#', '')
	if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(h)) {
		throw new Error(`bukan hex: ${hex}`)
	}
	const full =
		h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h
	return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
}

const luminance = (hex) => {
	const [r, g, b] = toRgb(hex).map((v) => {
		const c = v / 255
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const ratio = (a, b) => {
	const la = luminance(a)
	const lb = luminance(b)
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/* ---------- pasangan yang benar-benar dipakai UI ---------- */
const AA = 4.5 // teks normal (WCAG 2.2 SC 1.4.3)
const pairs = [
	['--accent', '--bg-raised', 'link di kartu'],
	['--accent', '--bg', 'link di halaman'],
	['--accent', '--accent-soft', 'ghost button hover'],
	['--accent', '--accent-tint', 'link di stat card accent'],
	['--accent-strong', '--bg-raised', 'link hover'],
	['--on-accent', '--accent', 'teks tombol primer'],
	['--danger', '--bg', 'judul error'],
	['--danger', '--danger-soft', 'badge rejected / pill offline'],
	['--ok', '--ok-soft', 'badge confirmed'],
	['--warn', '--warn-soft', 'badge pending'],
	['--ok', '--bg-raised', 'copy button sukses'],
	['--muted', '--bg', 'muted di halaman'],
	['--muted', '--bg-raised', 'muted di kartu'],
	['--muted', '--bg-subtle', 'muted di baris tabel hover'],
	['--muted', '--bg-hover', 'muted di raw JSON'],
	['--muted', '--accent-tint', 'hint di stat card accent'],
	['--text', '--bg-raised', 'teks utama'],
	['--text-soft', '--bg-raised', 'teks sekunder'],
	['--text', '--heat-0', 'angka tx di blok kosong (heatmap)'],
	['--heat-fg', '--heat-1', 'angka tx di blok level 1'],
	['--heat-fg', '--heat-2', 'angka tx di blok level 2'],
	['--heat-fg', '--heat-3', 'angka tx di blok level 3'],
	['--heat-fg', '--heat-4', 'angka tx di blok level 4'],
	['--heat-fg-5', '--heat-5', 'angka tx di blok paling ramai'],
	['--bg-raised', '--text', 'tooltip unit (inverse)'],
]

/* ---------- jalankan ---------- */
const themes = [
	['light', tokensOf(blockOf(':root'))],
	['dark', tokensOf(blockOf("[data-theme='dark']"))],
]

let fail = 0
let pass = 0

for (const [name, tokens] of themes) {
	console.log(`\n── theme: ${name} ──`)
	for (const [fgName, bgName, label] of pairs) {
		const fg = resolve(tokens, fgName)
		const bg = resolve(tokens, bgName)
		const r = ratio(fg, bg)
		const ok = r >= AA
		if (ok) pass += 1
		else fail += 1
		const flag = ok ? ' ok ' : 'FAIL'
		console.log(
			`  ${flag} ${r.toFixed(2).padStart(5)} : 1  ${label}  (${fgName} ${fg} on ${bgName} ${bg})`,
		)
	}
}

/* ---------- budget Fase 0: type scale & spacing ---------- */
console.log('\n── budget token (Fase 0) ──')
const paddings = [
	...new Set([...src.matchAll(/padding:\s*([^;]+);/g)].map((m) => m[1].trim())),
]
const rootColors = tokensOf(blockOf(':root'))
const fsTokens = [...rootColors.keys()].filter((k) => k.startsWith('--fs-'))
const spaceTokens = [...rootColors.keys()].filter((k) =>
	k.startsWith('--space-'),
)

const budget = [
	['token --fs-* (type scale)', fsTokens.length, 7],
	['token --space-* (spacing)', spaceTokens.length, 8],
	['nilai padding', paddings.length, 8],
	[
		'hex literal di luar blok token',
		src
			.replace(blockOf(':root'), '')
			.replace(blockOf("[data-theme='dark']"), '')
			.match(/#[0-9a-fA-F]{3,6}\b/g)?.length ?? 0,
		0,
	],
]

for (const [label, actual, limit] of budget) {
	const ok = actual <= limit
	if (ok) pass += 1
	else fail += 1
	console.log(
		`  ${ok ? ' ok ' : 'FAIL'} ${String(actual).padStart(2)} / ${limit}  ${label}`,
	)
}
console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
