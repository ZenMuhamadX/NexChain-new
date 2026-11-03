/**
 * Gate offline: token warna & kontras `src/style.css`.
 *
 * Dua kelas bug yang tidak terlihat sampai layar pengguna:
 *
 *   1. warna mentah (`#fff`, `rgba(...)`) yang ditulis langsung di sebuah
 *      aturan tidak ikut berubah saat tema berganti, jadi mode gelap
 *      menyisakan kotak putih. Semua warna harus lewat token `:root`.
 *   2. token yang lolos di tema terang tapi tidak didefinisikan di tema
 *      gelap — nilainya diwarisi dari terang, dan teksnya jadi tidak
 *      terbaca. Setiap token warna WAJIB punyaoverride gelap.
 *
 * Kontras dihitung dengan rasio WCAG 2.1 (4.5:1 untuk teks normal) dan
 * diperiksa untuk pasangan yang benar-benar dipakai layar, di kedua tema.
 *
 * Jalankan: bun scripts/styleAudit.ts   (dari `wallet/`)
 *           bun run wallet:style        (dari root repo)
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WALLET_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const STYLE_FILE = join(WALLET_DIR, 'src', 'style.css')
const LIGHT_SELECTOR = ':root {'
const DARK_SELECTOR = ":root[data-theme='dark'] {"
const MIN_CONTRAST = 4.5

// Token yang memang sama di kedua tema: latar QR harus tetap putih agar
// pemindai bisa membacanya walau aplikasi sedang gelap.
const SHARED_COLORS: ReadonlySet<string> = new Set(['--qr-bg'])

const PAIRS: ReadonlyArray<{ fg: string; bg: string }> = [
	{ fg: '--text', bg: '--surface' },
	{ fg: '--text', bg: '--bg' },
	{ fg: '--text-strong', bg: '--surface' },
	{ fg: '--text-muted', bg: '--surface' },
	{ fg: '--text-muted', bg: '--bg' },
	{ fg: '--text-subtle', bg: '--surface' },
	{ fg: '--text-subtle', bg: '--surface-subtle' },
	{ fg: '--placeholder', bg: '--surface' },
	{ fg: '--primary', bg: '--surface' },
	{ fg: '--primary-hover', bg: '--primary-soft' },
	{ fg: '--on-primary', bg: '--primary' },
	{ fg: '--on-primary', bg: '--danger' },
	{ fg: '--success', bg: '--success-soft' },
	{ fg: '--success', bg: '--surface' },
	{ fg: '--warning', bg: '--warning-soft' },
	{ fg: '--warning', bg: '--surface' },
	{ fg: '--danger', bg: '--danger-soft' },
	{ fg: '--danger', bg: '--surface' },
	{ fg: '--info', bg: '--info-soft' },
]

let passed = 0
let failed = 0

const ok = (condition: boolean, label: string, detail?: string): void => {
	if (condition) {
		passed += 1
		console.log(`OK   ${label}`)
		return
	}
	failed += 1
	console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

let css = readFileSync(STYLE_FILE, 'utf8')

// ---------------------------------------------------------------------------
// Blok token
// ---------------------------------------------------------------------------

/** Badan deklarasi sebuah blok, atau null bila selektornya tidak ada. */
const blockBody = (selector: string): string | null => {
	const start = css.indexOf(selector)
	if (start < 0) return null
	const open = css.indexOf('{', start)
	if (open < 0) return null
	let depth = 0
	for (let index = open; index < css.length; index += 1) {
		if (css[index] === '{') depth += 1
		else if (css[index] === '}') {
			depth -= 1
			if (depth === 0) return css.slice(open + 1, index)
		}
	}
	return null
}

/** Ganti isi blok dengan spasi (baris dipertahankan) agar nomor baris utuh. */
const blankBlock = (selector: string): void => {
	const body = blockBody(selector)
	if (body === null) return
	css = css.replace(body, body.replace(/[^\n]/g, ' '))
}

const parseTokens = (body: string): Map<string, string> => {
	const tokens = new Map<string, string>()
	for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		tokens.set(match[1], match[2].replace(/\s+/g, ' ').trim())
	}
	return tokens
}

const lightBody = blockBody(LIGHT_SELECTOR)
const darkBody = blockBody(DARK_SELECTOR)

ok(lightBody !== null, 'blok token terang `:root` ada')
ok(darkBody !== null, 'blok token gelap `:root[data-theme=\'dark\']` ada')

if (lightBody === null || darkBody === null) {
	console.log(`\n${passed} lulus, ${failed} gagal`)
	process.exit(1)
}

const light = parseTokens(lightBody)
const dark = parseTokens(darkBody)

// ---------------------------------------------------------------------------
// 1. Tidak ada warna mentah di luar blok token
// ---------------------------------------------------------------------------

blankBlock(LIGHT_SELECTOR)
blankBlock(DARK_SELECTOR)

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
const rawHits: string[] = []
css.split('\n').forEach((line, index) => {
	if (RAW_COLOR.test(line)) rawHits.push(`${index + 1}: ${line.trim()}`)
})
ok(rawHits.length === 0, 'warna mentah hanya ada di blok token', rawHits.slice(0, 8).join(' | '))

// ---------------------------------------------------------------------------
// 2. Setiap token warna punya padanan gelap
// ---------------------------------------------------------------------------

const isColor = (value: string): boolean => /#|rgba?\(|hsla?\(/.test(value)

const missingDark = [...light.entries()]
	.filter(([name, value]) => isColor(value) && !SHARED_COLORS.has(name) && !dark.has(name))
	.map(([name]) => name)
ok(
	missingDark.length === 0,
	'semua token warna didefinisikan di tema gelap',
	missingDark.join(', '),
)

const unknownDark = [...dark.keys()].filter((name) => !light.has(name))
ok(unknownDark.length === 0, 'tema gelap tidak menambah token asing', unknownDark.join(', '))

// ---------------------------------------------------------------------------
// 3. Kontras WCAG untuk pasangan yang dipakai
// ---------------------------------------------------------------------------

const parseHex = (value: string): [number, number, number] | null => {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
	if (!match) return null
	let hex = match[1]
	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((char) => char + char)
			.join('')
	}
	return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as [
		number,
		number,
		number,
	]
}

const channel = (value: number): number =>
	value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

const luminance = ([red, green, blue]: [number, number, number]): number =>
	0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)

const contrast = (
	first: [number, number, number],
	second: [number, number, number],
): number => {
	const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
	return (values[0] + 0.05) / (values[1] + 0.05)
}

const auditTheme = (label: string, tokens: Map<string, string>): void => {
	for (const { fg, bg } of PAIRS) {
		const fgValue = tokens.get(fg) ?? light.get(fg) ?? ''
		const bgValue = tokens.get(bg) ?? light.get(bg) ?? ''
		const fgColor = parseHex(fgValue)
		const bgColor = parseHex(bgValue)
		if (!fgColor || !bgColor) {
			ok(false, `${label}: ${fg} di ${bg}`, `token bukan hex: ${fgValue} / ${bgValue}`)
			continue
		}
		const value = contrast(fgColor, bgColor)
		ok(
			value >= MIN_CONTRAST,
			`${label}: ${fg} di ${bg} = ${value.toFixed(2)}:1`,
			`minimum ${MIN_CONTRAST}:1`,
		)
	}
}

auditTheme('terang', light)
auditTheme('gelap', dark)

console.log(`\n${passed} lulus, ${failed} gagal`)
if (failed > 0) process.exit(1)
