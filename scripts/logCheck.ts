/**
 * Gerbang regresi offline sistem log berkas (`check:log`).
 *
 * Jalankan:  bun run check:log
 *
 * Yang dijaga di sini adalah janji yang mudah rusak diam-diam:
 *
 *   1. **Tiga bagian yang murni** — `logFileName`, `stripAnsi`, dan
 *      `pruneOldLogs` tidak menyentuh I/O sama sekali, sehingga bisa diuji
 *      tanpa direktori maupun waktu nyata.
 *   2. **Retensi** — simpan `days` hari terakhir TERMASUK hari ini; berkas
 *      di luar pola `nex-YYYY-MM-DD.log` tidak pernah disentuh. Salah di sini
 *      berarti log pengguna hilang lebih cepat dari yang dijanjikan.
 *   3. **Berkas selalu lengkap** — baris level `debug` yang SENGAJA tidak
 *      dicetak ke konsol tetap harus masuk berkas. Inilah inti keputusan
 *      "konsol pelit, berkas lengkap": kalau regresi ini lewat, pengguna
 *      kehilangan detail justru saat sedang dibutuhkan.
 *   4. **Tanpa duplikasi** — baris yang dicetak lewat logger tidak boleh
 *      masuk berkas dua kali (sekali oleh logger, sekali lagi oleh tambalan
 *      `process.std*.write`).
 *   5. **Pemotongan baris** — tambalan `process.std*.write` menerima potongan
 *      sewenang-wenang; potongan setengah baris tidak boleh ditulis sebagai
 *      baris tersendiri (kalau tidak, berkas penuh baris terpenggal).
 *   6. **Berkas lama dipangkas saat pemasangan** — bukan hanya dihitung.
 */
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	emit,
	installFileLogging,
	logFileName,
	pruneOldLogs,
	stripAnsi,
} from 'src/logging/fileSink'

let pass = 0
let fail = 0

/** Tolak bila `cond` palsu — setiap pemeriksaan adalah fungsi kecil. */
const assert = (cond: boolean, message: string): void => {
	if (!cond) throw new Error(message)
}

/** Jalankan satu pemeriksaan bernama; galat = FAIL, bukan menghentikan gate. */
const run = async (
	name: string,
	fn: () => void | Promise<void>,
): Promise<void> => {
	try {
		await fn()
		pass++
		console.log(`  OK   ${name}`)
	} catch (error) {
		fail++
		const message = error instanceof Error ? error.message : String(error)
		console.log(`  FAIL ${name}  -> ${message}`)
	}
}

/** Tunggu sampai `check()` benar — sink memuat modul Node secara asinkron. */
const waitFor = async (check: () => boolean, ms = 3000): Promise<boolean> => {
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		if (check()) return true
		await new Promise((resolve) => setTimeout(resolve, 20))
	}
	return check()
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// GROUP 1 — logFileName (murni)
// ---------------------------------------------------------------------------

console.log('GROUP 1 — logFileName (murni, UTC):')

await run('tanggal biasa -> nex-YYYY-MM-DD.log', () => {
	assert(
		logFileName(new Date('2026-10-16T07:28:17.741Z')) === 'nex-2026-10-16.log',
		`dapat ${logFileName(new Date('2026-10-16T07:28:17.741Z'))}`,
	)
})

await run('bulan & hari satu digit di-pad nol', () => {
	assert(
		logFileName(new Date('2026-01-05T00:00:00.000Z')) === 'nex-2026-01-05.log',
		`dapat ${logFileName(new Date('2026-01-05T00:00:00.000Z'))}`,
	)
})

await run('menit terakhir hari itu masih tanggal yang sama (UTC)', () => {
	assert(
		logFileName(new Date('2026-10-16T23:59:59.999Z')) === 'nex-2026-10-16.log',
		`dapat ${logFileName(new Date('2026-10-16T23:59:59.999Z'))}`,
	)
})

await run('lewat tengah malam UTC -> tanggal berikutnya', () => {
	assert(
		logFileName(new Date('2026-10-17T00:00:00.000Z')) === 'nex-2026-10-17.log',
		`dapat ${logFileName(new Date('2026-10-17T00:00:00.000Z'))}`,
	)
})

// ---------------------------------------------------------------------------
// GROUP 2 — stripAnsi (murni)
// ---------------------------------------------------------------------------

console.log('')
console.log('GROUP 2 — stripAnsi (murni):')

await run('membuang warna chalk, menyisakan teks', () => {
	const colored = '\u001b[32minfo\u001b[39m \u001b[33m2026-10-16\u001b[39m'
	assert(
		stripAnsi(colored) === 'info 2026-10-16',
		`dapat ${JSON.stringify(stripAnsi(colored))}`,
	)
})

await run('teks tanpa ANSI tidak berubah', () => {
	const plain = '(info) [2026-10-16T07:28:17.741Z]: halo'
	assert(
		stripAnsi(plain) === plain,
		`dapat ${JSON.stringify(stripAnsi(plain))}`,
	)
})

await run('escape berurutan (reset + warna) ikut hilang', () => {
	assert(
		stripAnsi('\u001b[1m\u001b[36mP2P\u001b[0m aktif') === 'P2P aktif',
		`dapat ${JSON.stringify(stripAnsi('\u001b[1m\u001b[36mP2P\u001b[0m aktif'))}`,
	)
})

// ---------------------------------------------------------------------------
// GROUP 3 — pruneOldLogs (murni, tanpa I/O)
// ---------------------------------------------------------------------------

console.log('')
console.log('GROUP 3 — pruneOldLogs (murni):')

const NOW = new Date('2026-10-16T12:00:00.000Z')
const day = (d: number): string =>
	`nex-2026-10-${String(d).padStart(2, '0')}.log`

await run('days=3 -> sisakan 14, 15, 16; hapus 13 dan lebih tua', () => {
	const names = [day(11), day(12), day(13), day(14), day(15), day(16)]
	const removed = pruneOldLogs(names, NOW, 3).sort()
	assert(
		removed.join(',') === [day(11), day(12), day(13)].sort().join(','),
		`dapat ${removed.join(',')}`,
	)
})

await run('days=1 -> hanya hari ini yang disimpan', () => {
	const names = [day(13), day(14), day(15), day(16)]
	const removed = pruneOldLogs(names, NOW, 1).sort()
	assert(
		removed.join(',') === [day(13), day(14), day(15)].sort().join(','),
		`dapat ${removed.join(',')}`,
	)
})

await run('berkas di luar pola tidak pernah dihapus', () => {
	const names = [
		'other.log',
		'nex-bad.log',
		'nex-2026-10-13.log',
		'catatan.txt',
	]
	const removed = pruneOldLogs(names, NOW, 3)
	assert(
		removed.join(',') === 'nex-2026-10-13.log',
		`dapat ${removed.join(',')}`,
	)
})

await run('tanggal di masa depan tidak dihapus', () => {
	const removed = pruneOldLogs([day(20), day(16)], NOW, 3)
	assert(removed.length === 0, `dapat ${removed.join(',')}`)
})

await run('daftar kosong / semua baru -> tidak ada yang dihapus', () => {
	assert(pruneOldLogs([], NOW, 3).length === 0, 'daftar kosong harus kosong')
	assert(
		pruneOldLogs([day(14), day(15), day(16)], NOW, 3).length === 0,
		'tiga hari terakhir harus selamat',
	)
})

await run('days tidak masuk akal di-clamp, bukan menghapus segalanya', () => {
	// days=0 / negatif tidak boleh berarti "hapus semua".
	const removed = pruneOldLogs([day(11), day(16)], NOW, 0)
	assert(
		removed.join(',') === 'nex-2026-10-11.log',
		`days=0 harus berperilaku seperti days=1, dapat ${removed.join(',')}`,
	)
})

// ---------------------------------------------------------------------------
// GROUP 4 — tulis nyata ke direktori sementara (pemasangan + emit + tambalan)
// ---------------------------------------------------------------------------

console.log('')
console.log('GROUP 4 — tulis nyata ke direktori sementara:')

const dir = mkdtempSync(join(tmpdir(), 'nex-logcheck-'))

// Tanggal RELATIF hari ini, bukan harfiah: retensi dibandingkan dengan tanggal
// nyata saat gate berjalan, jadi menyemai "2026-10-13" akan membuat gate ini
// merah sendiri begitu hari berganti.
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (n: number): string =>
	logFileName(new Date(Date.now() - n * DAY_MS))
const staleName = daysAgo(3) // di luar retensi 3 hari -> harus dipangkas
const keptName = daysAgo(2) // masih di dalam retensi -> harus selamat

// Dipangkas saat pemasangan: `staleName` harus hilang, `keptName` selamat, dan
// `other.log` (di luar pola) tidak boleh disentuh.
writeFileSync(join(dir, staleName), '')
writeFileSync(join(dir, keptName), '')
writeFileSync(join(dir, 'other.log'), 'jangan sentuh')

installFileLogging({ dir, retentionDays: 3 })

const today = logFileName(new Date())
const file = join(dir, today)
const readLog = (): string => {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return ''
	}
}

await run('pemasangan memangkas berkas lebih tua dari retensi', () => {
	const names = readdirSync(dir)
	assert(
		!names.includes(staleName),
		`${staleName} seharusnya dipangkas, ada: ${names.join(',')}`,
	)
	assert(
		names.includes(keptName),
		`${keptName} masih dalam retensi, jangan dihapus`,
	)
	assert(
		names.includes('other.log'),
		'berkas di luar pola tidak boleh disentuh',
	)
})

const MARK_INFO = 'NEXLOGTEST_INFO_hanya_sekali'
const MARK_DEBUG = 'NEXLOGTEST_DEBUG_hanya_di_berkas'
const MARK_SPLIT = 'NEXLOGTEST_SPLIT_setengah_baris'
const MARK_ERR = 'NEXLOGTEST_ERR_dari_patch'

emit('info', MARK_INFO)
emit('debug', MARK_DEBUG, { toConsole: false })
emit('warn', 'NEXLOGTEST_WARN_level')

await run('baris info masuk berkas', async () => {
	assert(
		await waitFor(() => readLog().includes(MARK_INFO)),
		`berkas ${file} tidak memuat baris info:\n${readLog()}`,
	)
})

await run(
	'baris debug TETAP masuk berkas meski tidak dicetak ke konsol',
	async () => {
		assert(
			await waitFor(() => readLog().includes(MARK_DEBUG)),
			`baris debug hilang dari berkas:\n${readLog()}`,
		)
	},
)

await run('baris info tidak ditulis dua kali (logger vs tambalan std*)', () => {
	const count = readLog().split(MARK_INFO).length - 1
	assert(count === 1, `diharapkan 1 kemunculan, dapat ${count}`)
})

await run('berkas bebas escape ANSI', () => {
	const text = readLog()
	assert(
		stripAnsi(text) === text,
		'berkas masih memuat escape ANSI (warna chalk bocor ke berkas)',
	)
})

await run(
	'potongan setengah baris tidak ditulis sebagai baris sendiri',
	async () => {
		process.stdout.write(`${MARK_SPLIT}_`)
		process.stdout.write('lanjutan\n')
		const ok = await waitFor(() =>
			readLog()
				.split('\n')
				.some((line) => line.includes(`${MARK_SPLIT}_lanjutan`)),
		)
		assert(ok, `baris gabungan tidak muncul:\n${readLog()}`)
		const partial = readLog()
			.split('\n')
			.filter((line) => line.includes(MARK_SPLIT) && !line.includes('lanjutan'))
		assert(
			partial.length === 0,
			`potongan baris ikut tertulis: ${JSON.stringify(partial)}`,
		)
	},
)

await run('stderr yang ditambal ikut tercatat dengan penanda err', async () => {
	process.stderr.write(`${MARK_ERR}\n`)
	assert(
		await waitFor(() =>
			readLog()
				.split('\n')
				.some((line) => line.includes(MARK_ERR) && line.includes('[err]')),
		),
		`baris stderr tidak tercatat:\n${readLog()}`,
	)
})

// ---------------------------------------------------------------------------
// GROUP 5 — penerusan console.*
// ---------------------------------------------------------------------------
//
// Ini jalur terpisah dari tambalan stream, dan wajib terpisah: di Bun
// `console.log` TIDAK lewat `process.stdout.write`, sehingga menambal stream
// saja akan melewatkan seluruh output `console.*`. Di Node jalur itu justru
// memanggil `process.stdout.write` di baliknya — kalau penjaga re-entrancy
// bocor, setiap baris konsol tercatat DUA kali. Karena itu keduanya diuji.

console.log('')
console.log('GROUP 5 — penerusan console.*:')

const MARK_CLOG = 'NEXLOGTEST_CONSOLE_LOG_sekali'
const MARK_WRITE = 'NEXLOGTEST_STDOUT_WRITE_sekali'
const MARK_CERR = 'NEXLOGTEST_CONSOLE_ERR_sekali'

await run('console.log masuk berkas tepat sekali', async () => {
	console.log(MARK_CLOG)
	assert(
		await waitFor(() => readLog().includes(MARK_CLOG)),
		`console.log tidak tercatat:\n${readLog()}`,
	)
	const count = readLog().split(MARK_CLOG).length - 1
	assert(count === 1, `diharapkan 1 kemunculan, dapat ${count}`)
})

await run(
	'process.stdout.write langsung masuk berkas tepat sekali',
	async () => {
		process.stdout.write(`${MARK_WRITE}\n`)
		assert(
			await waitFor(() => readLog().includes(MARK_WRITE)),
			`stdout.write langsung tidak tercatat:\n${readLog()}`,
		)
		const count = readLog().split(MARK_WRITE).length - 1
		assert(count === 1, `diharapkan 1 kemunculan, dapat ${count}`)
	},
)

await run('console.error masuk berkas dengan penanda err', async () => {
	console.error(MARK_CERR)
	assert(
		await waitFor(() =>
			readLog()
				.split('\n')
				.some((line) => line.includes(MARK_CERR) && line.includes('[err]')),
		),
		`console.error tidak tercatat sebagai [err]:\n${readLog()}`,
	)
})

// Beri kesempatan flush terakhir sebelum ringkasan dicetak.
await sleep(100)

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exitCode = fail > 0 ? 1 : 0

// Dibersihkan SETELAH ringkasan: kalau tidak, baris ringkasan memicu
// peringatan "log berkas gagal ditulis" di konsol dan mengaburkan hasil gate.
rmSync(dir, { recursive: true, force: true })
