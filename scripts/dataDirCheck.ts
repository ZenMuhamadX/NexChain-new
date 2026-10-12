/**
 * Verifikasi lokasi & kesiapan direktori data node.
 *
 * Menjaga dua sifat yang mudah rusak tanpa disadari:
 *
 *   1. Lokasi data ditentukan `NEX_DATA_DIR` + cwd, **BUKAN** `__dirname`.
 *      Kalau lokasi kembali terikat ke berkas sumber, node akan membuka rantai
 *      kosong di tempat lain saat kode dipindah/di-bundle — diam-diam.
 *
 *   2. Direktori data yang tidak bisa disiapkan membuat node **GAGAL BOOT**
 *      (fail-closed), bukan lanjut dengan data yang tidak bisa disimpan.
 *      Kalau tidak, kegagalan baca/tulis muncul sebagai "rantai kosong" dan
 *      genesis baru ditulis di atas rantai yang sebenarnya ada.
 *
 * Jalankan: bun run check:data
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDataDir } from 'src/core/state/db/dataDir'

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}${extra ? `  [${extra}]` : ''}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? `  [${extra}]` : ''}`)
	}
}

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// 1. resolveDataDir — murni, tanpa efek samping
// ---------------------------------------------------------------------------

console.log('resolveDataDir — penentuan lokasi:')

const CWD = path.resolve('/repo-contoh')

check(
	'default tanpa env -> <cwd>/data',
	resolveDataDir({}, CWD) === path.join(CWD, 'data'),
	resolveDataDir({}, CWD),
)
check(
	'NEX_DATA_DIR absolut dipakai apa adanya',
	resolveDataDir({ NEX_DATA_DIR: path.resolve('/data-nex') }, CWD) ===
		path.resolve('/data-nex'),
	resolveDataDir({ NEX_DATA_DIR: path.resolve('/data-nex') }, CWD),
)
check(
	'NEX_DATA_DIR relatif diselesaikan terhadap cwd',
	resolveDataDir({ NEX_DATA_DIR: 'rel/data' }, CWD) ===
		path.join(CWD, 'rel', 'data'),
	resolveDataDir({ NEX_DATA_DIR: 'rel/data' }, CWD),
)
check(
	'NEX_DATA_DIR hanya spasi dianggap tidak diset',
	resolveDataDir({ NEX_DATA_DIR: '   ' }, CWD) === path.join(CWD, 'data'),
)
check(
	'lokasi mengikuti cwd, bukan lokasi berkas sumber',
	(() => {
		const a = resolveDataDir({}, '/satu')
		const b = resolveDataDir({}, '/dua')
		const suffix = (name: string): string => `${path.sep}${name}${path.sep}data`
		return a !== b && a.endsWith(suffix('satu')) && b.endsWith(suffix('dua'))
	})(),
)
check(
	'default TIDAK berada di dalam src/',
	!resolveDataDir({}, CWD).includes(path.join('src', 'core')),
	resolveDataDir({}, CWD),
)

// ---------------------------------------------------------------------------
// 2. Integrasi — node sungguhan, NEX_DATA_DIR diarahkan
// ---------------------------------------------------------------------------

const SUBDIRS = ['block', 'history', 'memPool', 'state', 'storeData']

interface BootResult {
	dirs: boolean
	exited: number | null
	output: string
}

/**
 * Jalankan node dengan `NEX_DATA_DIR` tertentu, tunggu sampai subdirektori data
 * muncul **dan** baris log boot tercetak (atau prosesnya berhenti lebih dulu),
 * lalu hentikan prosesnya.
 *
 * Baris "Data dir:" ditulis di callback listen — SETELAH direktori dibuat saat
 * impor. Berhenti begitu direktori ada saja membuat proses dihentikan sebelum
 * log-nya ter-flush, sehingga outputnya hilang.
 */
const bootWith = async (dataDir: string, port: number): Promise<BootResult> => {
	const child = spawn('bun', ['apps/node/server.ts'], {
		cwd: process.cwd(),
		env: {
			...process.env,
			NEX_DATA_DIR: dataDir,
			NEX_RPC_PORT: String(port),
			RPC_BIND_HOST: '127.0.0.1',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})

	let output = ''
	child.stdout.on('data', (chunk) => {
		output += String(chunk)
	})
	child.stderr.on('data', (chunk) => {
		output += String(chunk)
	})

	const hasDirs = (): boolean =>
		SUBDIRS.every((s) => fs.existsSync(path.join(dataDir, s)))

	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		if (child.exitCode !== null) break
		if (hasDirs() && output.includes('Data dir:')) break
		await delay(250)
	}

	// Pastikan proses BENAR-BENAR berhenti sebelum pemanggil menghapus direktori
	// data: LevelDB masih memegang lock file sampai prosesnya keluar, dan di
	// Windows itu membuat `rm` gagal dengan EBUSY.
	if (child.exitCode === null) {
		await new Promise<void>((done) => {
			child.once('exit', () => done())
			child.kill()
			setTimeout(done, 5_000)
		})
	}

	return { dirs: hasDirs(), exited: child.exitCode, output }
}

/** Hapus direktori sementara, dengan percobaan ulang untuk lock OS yang lambat. */
const rmWithRetry = async (dir: string): Promise<void> => {
	for (let attempt = 0; attempt < 12; attempt++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true })
			return
		} catch {
			await delay(250)
		}
	}
	// Sisa file sementara bukan kegagalan produk — jangan gagalkan gate ini.
	console.log(`  (catatan) tidak bisa menghapus ${dir} — dilewati`)
}

const cwdData = path.join(process.cwd(), 'data')
const cwdDataBefore = fs.existsSync(cwdData)

console.log('\nIntegrasi — node dijalankan dengan NEX_DATA_DIR:')

const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-datadir-'))
try {
	const res = await bootWith(tmpA, 8188)
	check('5 subdirektori dibuat di NEX_DATA_DIR', res.dirs, SUBDIRS.join(','))
	check('log boot menyebut lokasi data', res.output.includes('Data dir:'))
	check(
		'node tetap hidup setelah genesis (tidak crash)',
		res.exited === null,
		`exit=${res.exited}`,
	)
	if (!cwdDataBefore) {
		check('tidak ada ./data liar yang dibuat di cwd', !fs.existsSync(cwdData))
	}
} finally {
	await rmWithRetry(tmpA)
}

// ---------------------------------------------------------------------------
// 3. Integrasi — direktori data tidak bisa disiapkan -> harus gagal boot
// ---------------------------------------------------------------------------

console.log('\nFail-closed — direktori data tidak bisa disiapkan:')

const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-blocker-'))
try {
	// `blocker` adalah BERKAS, bukan folder, jadi `<blocker>/data` mustahil dibuat.
	const blocker = path.join(tmpB, 'blocker')
	fs.writeFileSync(blocker, 'berkas, bukan folder')

	const res = await bootWith(path.join(blocker, 'data'), 8189)
	check(
		'node GAGAL BOOT (exit != 0), bukan lanjut diam-diam',
		res.exited !== null && res.exited !== 0,
		`exit=${res.exited}`,
	)
	check(
		'pesan error menyebut direktori data / NEX_DATA_DIR',
		/tidak dapat disiapkan|NEX_DATA_DIR/.test(res.output),
	)
} finally {
	await rmWithRetry(tmpB)
}

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
