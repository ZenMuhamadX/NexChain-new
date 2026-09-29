/**
 * Snapshot Vendor — menyalin modul core browser-safe dari repo NexChain
 * (root) ke `wallet-ext/src/vendor/`.
 *
 * KENAPA ADA:
 *   wallet-ext harus MANDIRI (tidak boleh meng-import dari `../`). Namun
 *   logika crypto/transaksi (mnemonic, BIP32, signing, aturan nilai, aturan
 *   hash) HARUS identik dengan node. Jadi kita BEKUKAN salinan yang sudah
 *   teruji, bukan menduplikasi logika secara manual.
 *
 * PENDEKATAN: REACHABILITY (bukan whitelist direktori).
 *   Kita mulai dari ENTRY POINTS yang benar-benar dipakai wallet, lalu
 *   mengikuti import secara TRANSITIF. Hanya file yang benar-benar tercapai
 *   yang disalin. Ini mencegah "kebocoran" file Node-only (mis.
 *   `client/lib/createTransaction`, `nexchain/db/*`, `logging/*`) yang tidak
 *   pernah dipakai jalur browser tetapi ikut tersalin oleh whitelist direktori.
 *
 * CARA PAKAI:
 *   bun scripts/snapshotVendor.ts           # tulis/segarkan snapshot
 *   bun scripts/snapshotVendor.ts --check   # verifikasi snapshot tidak drift
 */

import { createHash } from 'node:crypto'
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const extRoot = join(here, '..')
const vendorDir = join(extRoot, 'src', 'vendor')
/**
 * OVERLAY — modul vendor yang SENGAJA berbeda dari root repo.
 *
 * File-file ini tetap disalin (logikanya masih dari root), tetapi komentar
 * dokumentasinya disesuaikan untuk extension karena root masih menyebut
 * IndexedDB sebagai backend browser. Kalau hash-nya dipaksa sama dengan
 * root, `vendor:check` akan terus melaporkan DRIFT setelah penyuntingan
 * sengaja ini.
 *
 * KONSEKUENSI: file di daftar ini TIDAK otomatis tersinkron. Bila logika
 * di root berubah, salin manual isi barunya lalu pertahankan bagian
 * komentar extension. Logikanya sendiri tidak diubah oleh overlay ini.
 */
const VENDOR_OVERLAY = new Set([
	'client/wallet/kv.ts',
	'client/wallet/walletVault.ts',
	// Deteksi secure-context harus mengenali `chrome-extension://` sebagai
	// konteks aman; tanpa cabang itu extension salah memakai fallback crypto
	// JS murni padahal `crypto.subtle` tersedia.
	'client/wallet/vaultCrypto.ts',
	// Transport fetch dapat di-inject: extension mengalihkan RPC lewat service
	// worker (di sana `host_permissions` berlaku, bukan CSP `connect-src`).
	'client/rpc-client/lib/rpcClient.ts',
])

const lockPath = join(vendorDir, 'VENDOR.lock.json')

/**
 * Lokasi SUMBER (root repo NexChain) yang dibaca untuk snapshot.
 *
 * DETACHED MODE — wallet-ext dirancang bisa dipisah dari root repo. Karena itu
 * lokasi sumber TIDAK dipatok ke `../` relatif terhadap folder ini, melainkan
 * dicari lewat urutan berikut:
 *
 *   1. argumen CLI   : `--source <path>`
 *   2. env           : `NEXCHAIN_ROOT`
 *   3. tetangga `../` (kasus normal: wallet-ext di dalam repo NexChain)
 *
 * Bila tidak ada satu pun yang valid, script TIDAK crash — ia melaporkan bahwa
 * mode detached aktif dan keluar dengan kode 0. Snapshot yang sudah ada di
 * `src/vendor/` tetap dipakai, sehingga `build`/`dev` di repo terpisah aman.
 */
const resolveRepoRoot = (): string | undefined => {
	const argIdx = process.argv.indexOf('--source')
	const fromArg =
		argIdx !== -1 && process.argv[argIdx + 1] ? process.argv[argIdx + 1] : undefined
	const fromEnv = process.env.NEXCHAIN_ROOT
	const fromNeighbor = join(extRoot, '..')

	const candidates = [fromArg, fromEnv, fromNeighbor].filter(
		(v): v is string => typeof v === 'string' && v.length > 0,
	)

	for (const candidate of candidates) {
		const abs = resolve(candidate)
		// Penanda root repo NexChain: folder `key/` + `nexchain/` harus ada.
		if (
			existsSync(join(abs, 'key', 'genKeyFromMnemonic.ts')) &&
			existsSync(join(abs, 'nexchain'))
		) {
			return abs
		}
	}
	return undefined
}

const repoRootCandidate = resolveRepoRoot()

/**
 * ENTRY POINTS — akar penelusuran. Semua spesifier ini identik dengan yang
 * dipakai oleh kode UI wallet-ext (lihat src/lib/*, src/workers/*).
 */
const ENTRY_POINTS: readonly string[] = [
	// Kripto & turunan kunci
	'key/genKeyFromMnemonic',
	'key/genAddrFromPubKey',
	'key/genRandomMnemonic',
	'key/validateMnemonic',
	'key/ecc',
	// Tanda tangan & verifikasi
	'sign/signTransaction',
	'sign/verifySIgnature',
	'sign/createSign',
	'sign/hashMessage',
	'sign/chainId',
	'sign/recoveryPubKey',
	// Komposisi & validasi transaksi (murni)
	'client/lib/createUnsignedTransaction',
	'client/lib/clientValidateTx',
	// Vault browser
	// CATATAN: `client/wallet/idbKv` SENGAJA tidak ada di sini. Extension
	// memakai `chrome.storage.local` sebagai satu-satunya backend vault
	// (lihat src/lib/walletKv.ts). Menyalin idbKv hanya membawa dependency
	// `idb` + jalur IndexedDB yang bisa menggantung.
	'client/wallet/walletVault',
	'client/wallet/kv',
	'client/wallet/vaultCrypto',
	// RPC client
	'client/rpc-client/lib/rpcClient',
	'client/rpc-client/lib/rpcRequest',
	'client/rpc-client/lib/decodeHexJson',
	'client/rpc-client/controller/rpcGetAccount',
	'client/rpc-client/controller/rpcGetNonce',
	'client/rpc-client/controller/rpcGetPendingBalance',
	// Aturan nilai & hash (KRITIS — harus identik dengan node)
	'nexchain/nexucoin/toNexu',
	'nexchain/nexucoin/toNxc',
	'nexchain/nexucoin/isNexu',
	'nexchain/nexucoin/isNexuCapped',
	'nexchain/hex/tx/encodeTx',
	'nexchain/hex/stringToHex',
	'nexchain/hex/hexToString',
	'nexchain/block/sha256',
	'nexchain/block/keccak256',
	'nexchain/transaction/createTxHash',
	'nexchain/transaction/utils/isValidAddress',
	'nexchain/transaction/utils/createMerkleRoot',
	'nexchain/lib/generateTimestampz',
	'account/utils/processPubKey',
	'account/backup/lib/bytesToHex',
]

/** Top-level dir root yang boleh disalin ke vendor. */
const VENDOR_TOP_LEVEL = new Set([
	'key',
	'sign',
	'client',
	'nexchain',
	'account',
	'interface',
	'logging',
])

/** Impor Node-only yang HARAM ada di snapshot. */
const FORBIDDEN_IMPORT_RE =
	/from\s+['"](node:)?(fs|path|os|level|winston|chalk|child_process|net|tls|stream|util)['"]/

/**
 * Spesifier yang SENGAJA tidak diikuti (Node-only / CLI / tidak dipakai jalur
 * browser). Bila modul yang tercapai mengimpornya, kita catat sebagai
 * "terminal" — import-nya dibiarkan apa adanya tetapi TIDAK ditarik.
 *
 * Modul-modul ini tidak pernah dieksekusi di jalur wallet, namun beberapa
 * modul core mengimpornya di level atas. Untuk kasus itu kita sediakan STUB
 * (lihat STUBS di bawah) supaya resolusi tetap valid tanpa membawa Node.
 */
const STUBS: Record<string, string> = {
	'logging/logging': `/**
 * STUB logging untuk wallet-ext.
 * Modul core mengimpornya, tetapi implementasi asli memakai winston/chalk
 * (Node-only) dan TIDAK dipakai jalur browser. Stub ini menjaga API minimal
 * sebagai no-op agar bundel browser tetap bebas Node.
 */
export const logToConsole = (..._args: unknown[]): void => {}
export const logToFile = (..._args: unknown[]): void => {}
export const logger = {
	info: (..._a: unknown[]): void => {},
	error: (..._a: unknown[]): void => {},
}
`,
	'logging/errorLog': `/** STUB errorLog untuk wallet-ext (lihat logging/logging). */
export const logError = (..._args: unknown[]): void => {}
export const loggingErr = (..._args: unknown[]): void => {}
`,
	'logging/debug': `/** STUB debug untuk wallet-ext (lihat logging/logging). */
export const loggingDebug = (..._args: unknown[]): void => {}
export const debug = (..._args: unknown[]): void => {}
export default (..._args: unknown[]): void => {}
`,
	'interface/module/writeLog': `/**
 * STUB writeLog untuk wallet-ext.
 * PENTING: \`logError\` di sini mengembalikan \`false\` (BUKAN void) karena
 * dipakai sebagai nilai balik di jalur validasi — mis.
 * \`return logError(...)\` di \`clientValidateTx\`. Mengembalikan void akan
 * membuat validator mengembalikan undefined dan transaksi tidak pernah lolos.
 */
export const logError = (..._args: unknown[]): boolean => false
export const writeLog = (..._args: unknown[]): void => {}
`,
}

const sha256Hex = (text: string): string =>
	createHash('sha256').update(text, 'utf8').digest('hex')

const IMPORT_RE =
	/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g

/** Import bernama biasa — dipakai untuk mendeteksi type-only yang belum eksplisit. */
const NAMED_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g

/**
 * Modul yang isinya HANYA tipe (di-erase saat kompilasi) dan TIDAK boleh
 * menarik runtime Node. Import ke modul ini ditulis ulang menjadi
 * `import type { ... }` di dalam snapshot supaya bundler tidak pernah
 * me-resolve rantai runtime-nya (mis. `setPendingBalance` → `nexchain/db/state`
 * → LevelDB).
 *
 * Modul ini TIDAK disalin sebagai file: kita sediakan deklarasi tipe lokal
 * (lihat TYPE_SHIMS) supaya dependensi runtime-nya benar-benar tidak ada.
 */
const TYPE_ONLY_MODULES = new Set<string>([
	'nexchain/transaction/setPendingBalance',
	'nexchain/transaction/getPendingBalance',
])

/**
 * Shims tipe — menggantikan modul type-only yang isi runtime-nya Node-only.
 * Isinya HANYA interface yang dipakai lintas batas (bukan implementasi).
 */
const TYPE_SHIMS: Record<string, string> = {
	'nexchain/transaction/setPendingBalance': `/**
 * SHIM TIPE untuk wallet-ext.
 *
 * Modul asli (nexchain/transaction/setPendingBalance.ts) memuat implementasi
 * yang menulis ke LevelDB lewat \`nexchain/db/state\` — Node-only dan tidak
 * dipakai wallet browser (wallet membaca pending balance lewat RPC).
 * Yang dibutuhkan hanya INTERFACE-nya, jadi itu saja yang didefinisikan di sini.
 */
export interface pendingBalance {
	address: string
	pendingAmount: number
}
`,
	'nexchain/transaction/getPendingBalance': `/** SHIM TIPE untuk wallet-ext (lihat setPendingBalance). */
export interface pendingBalance {
	address: string
	pendingAmount: number
}
`,
}

/**
 * Ubah import ke modul type-only menjadi `import type`, sehingga erat
 * dihapus oleh TypeScript/esbuild dan tidak menarik dependensi runtime.
 * Hanya menyentuh import bernama (`import { X } from '...'`) yang belum
 * memakai `import type`.
 */
const applyTypeOnlyRewrite = (content: string): string =>
	content.replace(
		NAMED_IMPORT_RE,
		(full, names: string, spec: string) =>
			TYPE_ONLY_MODULES.has(spec)
				? `import type {${names}} from '${spec}'`
				: full,
	)

/**
 * Root repo yang TERKONFIRMASI ada. Di-set sekali saat `run()` memulai
 * (setelah guard detached). Helper di bawah mengasumsikan nilai ini terisi —
 * `run()` selalu mengecek `resolveRepoRoot()` lebih dulu dan keluar bila kosong.
 */
let repoRoot = ''

/** Resolve spesifier root-relatif ('key/ecc') → path absolut di repoRoot. */
const resolveVendorSpecifier = (spec: string): string | undefined => {
	const candidates = [
		join(repoRoot, spec + '.ts'),
		join(repoRoot, spec, 'index.ts'),
		join(repoRoot, spec),
	]
	for (const c of candidates) {
		if (existsSync(c) && statSync(c).isFile()) return c
	}
	return undefined
}

/** Resolve import relatif dari sebuah file sumber → path absolut. */
const resolveRelative = (fromFile: string, spec: string): string | undefined => {
	const base = resolve(dirname(fromFile), spec)
	const candidates = [base + '.ts', join(base, 'index.ts'), base]
	for (const c of candidates) {
		if (existsSync(c) && statSync(c).isFile()) return c
	}
	return undefined
}

/** Normalisasi pasangan (logical spec, absolute path) untuk file yang dicapai. */
interface Reached {
	logical: string
	abs: string
}

const reached = new Map<string, Reached>()
const missingLogical = new Set<string>()

/**
 * Telusuri apakah import relatif (di dalam shared module) menunjuk ke shared
 * module lain yang juga harus disalin. Karena file sumber TIDAK dipindahkan
 * (kita salin dengan struktur yang sama), import relatif tetap valid.
 */
const traverseFile = (abs: string, logical: string): void => {
	if (reached.has(abs)) return
	reached.set(abs, { logical, abs })

	const content = readFileSync(abs, 'utf8')
	for (const match of content.matchAll(IMPORT_RE)) {
		const spec = match[1]

		if (spec.startsWith('.')) {
			const target = resolveRelative(abs, spec)
			if (target) {
				const relLogical = relative(repoRoot, target).replace(/\\/g, '/').replace(/\.ts$/, '')
				traverseFile(target, relLogical)
			} else if (spec.includes('.wasm')) {
				// mis. tiny-secp256k1 — sengaja tidak dipakai (lihat key/ecc.ts).
				continue
			}
			continue
		}

		const top = spec.split('/')[0]
		if (!VENDOR_TOP_LEVEL.has(top)) continue

		// Stub? → tidak perlu menelusuri root, cukup tandai.
		if (spec in STUBS) continue

		// Modul type-only: HANYA tipe yang dipakai; jangan ikuti import
		// runtime-nya (yang bisa menarik LevelDB/Node). Tidak disalin dari
		// sumber — diganti shim tipe (lihat TYPE_SHIMS).
		if (TYPE_ONLY_MODULES.has(spec)) continue

		const target = resolveVendorSpecifier(spec)
		if (target) {
			traverseFile(target, spec)
		} else {
			missingLogical.add(spec)
		}
	}
}

const run = (): void => {
	const checkOnly = process.argv.includes('--check')

	// 0. Detached mode — root repo tidak ditemukan.
	//    Ini BUKAN kegagalan: wallet-ext memang dirancang bisa berdiri sendiri.
	//    Snapshot yang sudah ada tetap valid dan dipakai build.
	if (!repoRootCandidate) {
		const hasSnapshot = existsSync(lockPath)
		const mode = checkOnly ? 'vendor:check' : 'vendor:snapshot'
		console.log(
			`[vendor] Mode detached — root repo NexChain tidak ditemukan.\n` +
				`         Dicari via: --source <path> | NEXCHAIN_ROOT | tetangga ../\n` +
				`         Snapshot di src/vendor/ ${hasSnapshot ? 'ADA dan tetap dipakai' : 'BELUM ADA'}.`,
		)
		console.log(
			hasSnapshot
				? `[vendor] Lewati ${mode} (tidak ada sumber untuk disinkronkan). Build tetap aman.`
				: `[vendor] PERINGATAN: tidak ada snapshot & tidak ada sumber — build akan gagal resolve import vendor.`,
		)
		// Exit 0: absennya root bukan error di repo terpisah.
		process.exit(0)
	}

	// Setelah guard di atas, repoRoot pasti terisi.
	repoRoot = repoRootCandidate

	// 1. Telusuri seluruh reachability dari entry points.
	for (const entry of ENTRY_POINTS) {
		const abs = resolveVendorSpecifier(entry)
		if (!abs) {
			console.error(`[vendor] Entry point tidak ditemukan: ${entry}`)
			process.exit(1)
		}
		traverseFile(abs, entry)
	}

	if (missingLogical.size > 0) {
		console.error(
			`[vendor] ${missingLogical.size} spesifier tidak dapat di-resolve dan bukan stub:`,
		)
		for (const m of missingLogical) console.error('   -', m)
		process.exit(1)
	}

	// 2. Bangun daftar tulis: file reachable + stub.
	const files = [...reached.values()]
	const lock: Record<string, string> = {}
	const violations: string[] = []
	let written = 0

	for (const { logical, abs } of files) {
		const top = logical.split('/')[0]
		if (!VENDOR_TOP_LEVEL.has(top)) continue

		const content = readFileSync(abs, 'utf8')
		if (FORBIDDEN_IMPORT_RE.test(content)) {
			violations.push(logical)
			continue
		}

		// Tulis ulang import type-only agar dependensi runtime-nya tidak
		// pernah ikut ter-bundle (lihat TYPE_ONLY_MODULES).
		const finalContent = applyTypeOnlyRewrite(content)

		const relPath = relative(repoRoot, abs).replace(/\\/g, '/')
		const dest = join(vendorDir, relPath)
		const overlaid = VENDOR_OVERLAY.has(relPath)
		if (!checkOnly && !overlaid) {
			mkdirSync(dirname(dest), { recursive: true })
			writeFileSync(dest, finalContent, 'utf8')
		}
		// Overlay: hash diambil dari salinan vendor (yang sudah disunting),
		// bukan dari root — supaya vendor:check tidak melaporkan drift palsu.
		lock[relPath] = overlaid
			? sha256Hex(readFileSync(dest, 'utf8'))
			: sha256Hex(finalContent)
		written++
	}

	// 3. Tulis stub (diperlakukan sama seperti file vendor lain untuk lock).
	for (const [logical, source] of Object.entries(STUBS)) {
		const relPath = logical + '.ts'
		const dest = join(vendorDir, relPath)
		if (!checkOnly) {
			mkdirSync(dirname(dest), { recursive: true })
			writeFileSync(dest, source, 'utf8')
		}
		lock[relPath] = sha256Hex(source)
		written++
	}

	// 4. Tulis shim tipe (menggantikan modul yang runtime-nya Node-only).
	for (const [logical, source] of Object.entries(TYPE_SHIMS)) {
		const relPath = logical + '.ts'
		const dest = join(vendorDir, relPath)
		if (!checkOnly) {
			mkdirSync(dirname(dest), { recursive: true })
			writeFileSync(dest, source, 'utf8')
		}
		lock[relPath] = sha256Hex(source)
		written++
	}

	if (violations.length > 0) {
		console.error(
			`[vendor] DITOLAK — ${violations.length} file mengandung import Node-only:`,
		)
		for (const v of violations) console.error('   -', v)
		process.exit(1)
	}

	if (checkOnly) {
		if (!existsSync(lockPath)) {
			console.error('[vendor] VENDOR.lock.json tidak ada — jalankan snapshot.')
			process.exit(1)
		}
		const prev = JSON.parse(readFileSync(lockPath, 'utf8')) as {
			files?: Record<string, string>
		}
		const prevFiles = prev.files ?? {}
		const drift: string[] = []
		for (const [rel, hash] of Object.entries(lock)) {
			if (prevFiles[rel] !== hash) drift.push(rel)
		}
		for (const rel of Object.keys(prevFiles)) {
			if (!(rel in lock)) drift.push(`${rel} (dihapus)`)
		}
		if (drift.length > 0) {
			console.error(`[vendor] DRIFT pada ${drift.length} file:`)
			for (const d of drift.slice(0, 30)) console.error('   -', d)
			console.error('\nJalankan `bun run vendor:snapshot` untuk menyegarkan.')
			process.exit(1)
		}
		console.log(`[vendor] OK — ${Object.keys(prevFiles).length} file sinkron.`)
		return
	}

	writeFileSync(
		lockPath,
		JSON.stringify(
			{
				source: 'NexChain root repo (reachability snapshot)',
				vendoredAt: new Date().toISOString(),
				entryPoints: ENTRY_POINTS.length,
				stubs: Object.keys(STUBS),
				fileCount: written,
				files: lock,
			},
			null,
			2,
		),
		'utf8',
	)

	console.log(
		`[vendor] Snapshot selesai: ${written} file (${Object.keys(STUBS).length} stub) → src/vendor/`,
	)
	const byTop = Object.keys(lock).reduce<Record<string, number>>((acc, rel) => {
		const top = rel.split('/')[0]
		acc[top] = (acc[top] ?? 0) + 1
		return acc
	}, {})
	for (const [top, count] of Object.entries(byTop).sort()) {
		console.log(`   ${top.padEnd(12)} ${count} file`)
	}
}

run()
