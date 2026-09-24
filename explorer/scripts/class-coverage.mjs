/**
 * Statis audit: semua class yang dipakai di TSX harus punya aturan di
 * style.css, supaya komponen baru tidak diam-diam tampil tanpa styling.
 *
 * Interpolasi `${…}` dibuang dulu supaya `heat-${level}` tidak terbaca
 * sebagai class, dan hanya isi string literal yang dihitung (nama variabel
 * seperti `className={classes}` bukan class). Kelas yang lahir dari
 * interpolasi atau dari variabel dicatat eksplisit di bawah.
 *
 * Jalankan: node scripts/class-coverage.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src', 'style.css'), 'utf8')

const IDENT = /^[a-zA-Z][\w-]*$/

const cssClasses = new Set()
for (const match of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) cssClasses.add(match[1])

/** class yang hanya muncul lewat interpolasi — wajib ada juga. */
const DYNAMIC_CLASSES = [
	'badge-confirmed',
	'badge-pending',
	'badge-rejected',
	'badge-contract',
	'heat-0',
	'heat-1',
	'heat-2',
	'heat-3',
	'heat-4',
	'heat-5',
	'is-new',
	'is-current',
	'is-tip',
	'is-disabled',
	'is-latest',
	'is-fresh',
	'is-full',
	'chain-pill-down',
	'stat-accent',
	'copy-btn-ok',
	'copy-btn-failed',
	// class list yang disimpan dulu ke variabel lalu dipakai di className=
	'copy-btn',
	'link-plain',
	'no-link',
	'mono',
]

const files = []
const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) walk(full)
		else if (/\.(tsx|ts)$/.test(entry.name)) files.push(full)
	}
}
walk(join(root, 'src'))

/** Potong nilai atribut className, termasuk expression bersarang `{…}`. */
const classNameValues = (src) => {
	const out = []
	let from = 0
	for (;;) {
		const at = src.indexOf('className=', from)
		if (at < 0) return out
		let i = at + 'className='.length
		if (src[i] === '{') {
			let depth = 0
			let j = i
			for (; j < src.length; j += 1) {
				const ch = src[j]
				if (ch === "'" || ch === '"' || ch === '`') {
					const quote = ch
					j += 1
					while (j < src.length && src[j] !== quote) {
						if (src[j] === '\\') j += 1
						j += 1
					}
					continue
				}
				if (ch === '{') depth += 1
				else if (ch === '}') {
					depth -= 1
					if (depth === 0) {
						j += 1
						break
					}
				}
			}
			out.push(src.slice(i + 1, j - 1))
			from = j
		} else if (src[i] === '"') {
			const end = src.indexOf('"', i + 1)
			// bungkus ulang agar ikut terbaca sebagai string literal
			out.push(`"${src.slice(i + 1, end)}"`)
			from = end + 1
		} else {
			from = i + 1
		}
	}
}

const used = new Set(DYNAMIC_CLASSES)
for (const file of files) {
	const src = readFileSync(file, 'utf8')
	for (const raw of classNameValues(src)) {
		const text = raw.replace(/\$\{[^}]*\}/g, ' ')
		for (const literal of text.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
			const value = literal[1] ?? literal[2] ?? literal[3] ?? ''
			for (const token of value.split(/\s+/)) {
				if (IDENT.test(token) && !token.endsWith('-')) used.add(token)
			}
		}
	}
}

const missing = [...used].filter((cls) => !cssClasses.has(cls)).sort()

console.log(`class dipakai di TSX   : ${used.size}`)
console.log(`class tanpa aturan CSS : ${missing.length}`)
if (missing.length) {
	for (const cls of missing) console.log(`  missing: .${cls}`)
	process.exit(1)
}
console.log('semua class terpetakan ke style.css.')
