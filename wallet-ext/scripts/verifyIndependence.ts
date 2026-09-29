/**
 * Verifikasi Kemandirian (independence) wallet-ext.
 *
 * Tujuan: MEMBUKTIKAN secara mekanis bahwa tidak ada satu pun file di
 * `src/` yang meng-import keluar dari folder `wallet-ext/`.
 *
 * Cara: untuk setiap import relatif (`./` atau `../`) dan setiap specifier
 * bare alias (`key/`, `client/`, `nexchain/`, dst.), resolve target-nya dan
 * pastikan hasilnya BERADA DI DALAM `wallet-ext/src/`.
 *
 * Jalankan: bun scripts/verifyIndependence.ts
 * Exit 0 = mandiri; exit 1 = ada kebocoran.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const extRoot = resolve(here, '..')
const srcRoot = join(extRoot, 'src')

/** Alias bare yang dipetakan ke src/vendor — sama seperti vite.config.ts. */
const VENDOR_ALIASES = [
	'account',
	'base',
	'client',
	'common',
	'interface',
	'key',
	'logging',
	'nexchain',
	'rpc',
	'scripts',
	'sign',
	'wallet',
] as const

const walk = (dir: string, out: string[] = []): string[] => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
			walk(full, out)
		} else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
			out.push(full)
		}
	}
	return out
}

const IMPORT_RE =
	/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g

/**
 * Buang komentar sebelum memindai import.
 * Tanpa ini, penyebutan contoh seperti `"./secp256k1.wasm"` di dalam JSDoc
 * (yang justru menjelaskan mengapa modul itu TIDAK dipakai) akan terhitung
 * sebagai import palsu.
 */
const stripComments = (content: string): string =>
	content
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1')

/** True bila path berada di dalam `srcRoot`. */
const isInside = (p: string): boolean => {
	const rel = relative(srcRoot, p)
	return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

const resolveSpecifier = (fromFile: string, spec: string): string | undefined => {
	if (spec.startsWith('.')) {
		const base = resolve(dirname(fromFile), spec)
		for (const cand of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) {
			if (existsSync(cand) && statSync(cand).isFile()) return cand
		}
		return base
	}
	// Bare alias → src/vendor/<alias>/...
	const top = spec.split('/')[0]
	if ((VENDOR_ALIASES as readonly string[]).includes(top)) {
		const base = join(srcRoot, 'vendor', spec)
		for (const cand of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) {
			if (existsSync(cand) && statSync(cand).isFile()) return cand
		}
		return base
	}
	// Alias `@/` → src/
	if (spec.startsWith('@/')) {
		const base = join(srcRoot, spec.slice(2))
		for (const cand of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) {
			if (existsSync(cand) && statSync(cand).isFile()) return cand
		}
		return base
	}
	// Paket npm — diabaikan (bukan tanggung jawab verifikasi ini).
	return undefined
}

const files = walk(srcRoot)
const leaks: { file: string; spec: string; target: string }[] = []
const unresolved: { file: string; spec: string }[] = []

for (const file of files) {
	const content = stripComments(readFileSync(file, 'utf8'))
	for (const match of content.matchAll(IMPORT_RE)) {
		const spec = match[1]
		const target = resolveSpecifier(file, spec)
		if (target === undefined) continue // paket npm
		if (!isInside(target)) {
			leaks.push({ file: relative(extRoot, file), spec, target: relative(extRoot, target) })
		} else if (!existsSync(target) && !existsSync(target + '.ts')) {
			unresolved.push({ file: relative(extRoot, file), spec })
		}
	}
}

console.log(`[verify] Memeriksa ${files.length} file di src/ …`)

if (unresolved.length > 0) {
	console.error(`\n[verify] ${unresolved.length} import TIDAK TERSELESAIKAN:`)
	for (const u of unresolved.slice(0, 20)) {
		console.error(`   - ${u.file}  →  ${u.spec}`)
	}
}

if (leaks.length > 0) {
	console.error(`\n[verify] GAGAL — ${leaks.length} import keluar dari wallet-ext:`)
	for (const l of leaks.slice(0, 30)) {
		console.error(`   - ${l.file}\n       spec: ${l.spec}\n       target: ${l.target}`)
	}
	console.error('\nwallet-ext TIDAK mandiri. Perbaiki import / tambahkan ke snapshot vendor.')
	process.exit(1)
}

if (unresolved.length > 0) {
	console.error('\n[verify] GAGAL — ada import yang tidak bisa di-resolve.')
	process.exit(1)
}

console.log('[verify] OK — SEMUA import berada di dalam wallet-ext/src. Mandiri. ✓')
