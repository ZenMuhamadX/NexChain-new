/**
 * Gerbang regresi "keamanan RPC P0-B".
 *
 * Jalankan:  bun run check:rpc
 *
 * Empat kelompok yang dicegah regresinya di sini:
 *
 *   1. **Method tulis vs baca** — `nex_sendTransaction`,
 *      `nex_sendRawTransaction`, `nex_getWork`, `nex_submitWork` wajib
 *      autentikasi; method baca tidak pernah. Body batch diperiksa
 *      ekuivalen dengan body objek tunggal (satu request HTTP bisa memuat
 *      banyak method tulis).
 *   2. **Keputusan Basic Auth** — kredensial terkonfigurasi → wajib header
 *      yang benar (401 + tantangan bila salah); tanpa kredensial → hanya
 *      loopback yang boleh menulis (403 dari remote); header rusak = 401.
 *   3. **Pemeriksaan boot** — bind non-loopback tanpa kredensial MENOLAK
 *      start; loopback tanpa kredensial boleh tapi dengan peringatan.
 *   4. **Allowlist CORS** — daftar default (port UI dev + `null` untuk shell
 *      Electron file://), origin asing ditolak, dan `RPC_CORS_ORIGINS`
 *      dihormati apa adanya.
 *
 * Seluruhnya murni: tanpa server, tanpa port, tanpa LevelDB — aman dijalankan
 * kapan pun. Modul yang diuji (`src/rpc/authLogic.ts`, `src/rpc/corsOrigins.ts`)
 * sengaja tidak mengimpor express supaya tes ini benar-benar offline.
 */
import {
	WRITE_METHODS,
	extractMethods,
	isWriteMethod,
	isLoopbackAddress,
	evaluateRpcAuth,
	checkBindAndAuth,
} from 'src/rpc/authLogic'
import { parseCorsOrigins, isOriginAllowed } from 'src/rpc/corsOrigins'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? '  -> ' + extra : ''}`)
	}
}

/** Header Basic yang valid untuk `user`:`password`. */
const basic = (user: string, password: string): string =>
	`Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`

const USER = 'node-user'
const PASSWORD = 'rahasia-123'

// ---------------------------------------------------------------------------
// 1. Metode tulis & ekstraksi body (objek maupun batch)
// ---------------------------------------------------------------------------

console.log('GROUP 1 — method tulis vs baca + ekstraksi body:')

ok(
	'daftar method tulis berisi 4 method (transaksi x2, mining x2)',
	WRITE_METHODS.length === 4 &&
		[
			'nex_sendTransaction',
			'nex_sendRawTransaction',
			'nex_getWork',
			'nex_submitWork',
		].every((method) => WRITE_METHODS.includes(method)),
	WRITE_METHODS.join(','),
)
ok(
	'nex_getCurrentBlock BUKAN method tulis (baca = tanpa auth)',
	isWriteMethod('nex_getCurrentBlock') === false,
)
ok(
	'extractMethods objek tunggal mengambil method',
	JSON.stringify(
		extractMethods({ jsonrpc: '2.0', id: 1, method: 'nex_getWork' }),
	) === '["nex_getWork"]',
)
ok(
	'extractMethods batch mengambil SEMUA method (termasuk yang tulis)',
	JSON.stringify(
		extractMethods([
			{ method: 'nex_getCurrentBlock' },
			{ method: 'nex_submitWork' },
			{ method: 'nex_getBalance' },
		]),
	) === '["nex_getCurrentBlock","nex_submitWork","nex_getBalance"]',
)
ok(
	'extractMethods body non-objek / entri rusak → [] (tidak crash)',
	extractMethods(null).length === 0 &&
		extractMethods('nex_getWork').length === 0 &&
		extractMethods([null, 42, 'x']).length === 0,
)

// Batch berisi SATU method tulis = seluruh request wajib auth.
const batchWithWrite = extractMethods([
	{ method: 'nex_getCurrentBlock' },
	{ method: 'nex_sendRawTransaction' },
])
const batchWriteNoCreds = evaluateRpcAuth(
	batchWithWrite,
	undefined,
	'192.168.1.50',
	USER,
	PASSWORD,
)
ok(
	'batch berisi method tulis TANPA kredensial di header → ditolak',
	batchWriteNoCreds.ok === false && batchWriteNoCreds.status === 401,
)
ok(
	'batch berisi method tulis DENGAN kredensial benar → lolos',
	evaluateRpcAuth(
		batchWithWrite,
		basic(USER, PASSWORD),
		'192.168.1.50',
		USER,
		PASSWORD,
	).ok === true,
)

const batchReadOnly = extractMethods([
	{ method: 'nex_getCurrentBlock' },
	{ method: 'nex_getBalance', params: 'NxC0' },
])
ok(
	'batch baca-saja TANPA kredensial → lolos',
	evaluateRpcAuth(batchReadOnly, undefined, '203.0.113.7', USER, PASSWORD)
		.ok === true,
)

// ---------------------------------------------------------------------------
// 2. Keputusan Basic Auth (kredensial terkonfigurasi)
// ---------------------------------------------------------------------------

console.log('GROUP 2 — Basic Auth dengan RPC_USER/RPC_PASSWORD terkonfigurasi:')

ok(
	'write + kredensial benar → ok',
	evaluateRpcAuth(
		['nex_getWork'],
		basic(USER, PASSWORD),
		'203.0.113.7',
		USER,
		PASSWORD,
	).ok === true,
)
const writeNoCreds = evaluateRpcAuth(
	['nex_sendRawTransaction'],
	undefined,
	'203.0.113.7',
	USER,
	PASSWORD,
)
ok(
	'write TANPA header → 401 + tantangan WWW-Authenticate',
	writeNoCreds.ok === false &&
		writeNoCreds.status === 401 &&
		writeNoCreds.challenge === true,
)
const writeWrongPass = evaluateRpcAuth(
	['nex_sendTransaction'],
	basic(USER, 'salah'),
	'127.0.0.1',
	USER,
	PASSWORD,
)
ok(
	'write password salah → 401 + tantangan',
	writeWrongPass.ok === false &&
		writeWrongPass.status === 401 &&
		writeWrongPass.challenge === true,
)
const writeWrongUser = evaluateRpcAuth(
	['nex_getWork'],
	basic('lain', PASSWORD),
	'127.0.0.1',
	USER,
	PASSWORD,
)
ok(
	'write user salah → 401 + tantangan',
	writeWrongUser.ok === false &&
		writeWrongUser.status === 401 &&
		writeWrongUser.challenge === true,
)
ok(
	'write header rusak / bukan skema Basic → 401 (bukan lolos)',
	[
		undefined,
		'',
		'Bearer abc',
		'Basic !!!bukan-base64!!!',
		'Basic ' + Buffer.from('tanpa-pemisah-titik-dua').toString('base64'),
		'Basic',
	].every((header) => {
		const decision = evaluateRpcAuth(
			['nex_submitWork'],
			header,
			'203.0.113.7',
			USER,
			PASSWORD,
		)
		return decision.ok === false && decision.status === 401
	}),
)
ok(
	'read TANPA header walaupun kredensial diset → ok (tidak dipaksa)',
	evaluateRpcAuth(
		['nex_getCurrentBlock'],
		undefined,
		'203.0.113.7',
		USER,
		PASSWORD,
	).ok === true,
)
ok(
	'write kredensial benar dari alamat remote → ok (kredensial mengalahkan lokasi)',
	evaluateRpcAuth(
		['nex_getWork'],
		basic(USER, PASSWORD),
		'10.0.0.9',
		USER,
		PASSWORD,
	).ok === true,
)

// ---------------------------------------------------------------------------
// 3. Tanpa kredensial → hanya loopback
// ---------------------------------------------------------------------------

console.log('GROUP 3 — tanpa kredensial: method tulis hanya loopback:')

ok(
	'write dari 127.0.0.1 → ok',
	evaluateRpcAuth(['nex_getWork'], undefined, '127.0.0.1', undefined, undefined)
		.ok === true,
)
ok(
	'write dari ::1 → ok',
	evaluateRpcAuth(['nex_getWork'], undefined, '::1', undefined, undefined)
		.ok === true,
)
ok(
	'write dari ::ffff:127.0.0.1 (IPv4-mapped loopback) → ok',
	evaluateRpcAuth(
		['nex_getWork'],
		undefined,
		'::ffff:127.0.0.1',
		undefined,
		undefined,
	).ok === true,
)
const writeRemoteNoCreds = evaluateRpcAuth(
	['nex_sendRawTransaction'],
	undefined,
	'192.168.1.50',
	undefined,
	undefined,
)
ok(
	'write dari remote (192.168.1.50) → 403 (bukan 401: tidak ada yang divalidasi)',
	writeRemoteNoCreds.ok === false && writeRemoteNoCreds.status === 403,
)
ok(
	'read dari remote tanpa kredensial → ok',
	evaluateRpcAuth(
		['nex_getBalance'],
		undefined,
		'192.168.1.50',
		undefined,
		undefined,
	).ok === true,
)
ok(
	'loopback: 127.x dikenali, 10.x / 172.16.x / string kosong BUKAN loopback',
	isLoopbackAddress('127.0.0.2') === true &&
		isLoopbackAddress('192.168.1.1') === false &&
		isLoopbackAddress('10.0.0.1') === false &&
		isLoopbackAddress('') === false,
)

// ---------------------------------------------------------------------------
// 4. Pemeriksaan boot: bind non-loopback tanpa kredensial = gagal start
// ---------------------------------------------------------------------------

console.log('GROUP 4 — pemeriksaan boot (bind vs kredensial):')

const failOpen = checkBindAndAuth('0.0.0.0', undefined, undefined)
ok(
	'bind 0.0.0.0 + tanpa kredensial → MENOLAK start',
	failOpen.ok === false && failOpen.message.length > 0,
	failOpen.ok ? '(lolos)' : '(tanpa pesan)',
)
const failPartial = checkBindAndAuth('0.0.0.0', USER, undefined)
ok(
	'bind non-loopback + kredensial SEPARUH → MENOLAK start',
	failPartial.ok === false,
)
ok(
	'bind 192.168.1.5 + kredensial lengkap → start',
	checkBindAndAuth('192.168.1.5', USER, PASSWORD).ok === true,
)
const loopbackNoCreds = checkBindAndAuth('127.0.0.1', undefined, undefined)
ok(
	'bind loopback + tanpa kredensial → start DENGAN peringatan keras',
	loopbackNoCreds.ok === true &&
		loopbackNoCreds.warning.length > 0 &&
		/proxy/i.test(loopbackNoCreds.warning),
	'(peringatan hilang / tidak menyebut proxy)',
)
const loopbackWithCreds = checkBindAndAuth('127.0.0.1', USER, PASSWORD)
ok(
	'bind loopback + kredensial lengkap → start tanpa peringatan',
	loopbackWithCreds.ok === true && loopbackWithCreds.warning === '',
)
ok(
	'bind "localhost" / "::1" dianggap loopback',
	checkBindAndAuth('localhost', undefined, undefined).ok === true &&
		checkBindAndAuth('::1', undefined, undefined).ok === true,
)

// ---------------------------------------------------------------------------
// 5. Allowlist CORS
// ---------------------------------------------------------------------------

console.log('GROUP 5 — allowlist CORS:')

const defaults = parseCorsOrigins(undefined)
const EXPECTED_DEFAULTS = [
	'http://localhost:5173',
	'http://localhost:5174',
	'http://localhost:5175',
	'http://127.0.0.1:5173',
	'http://127.0.0.1:5174',
	'http://127.0.0.1:5175',
	'null',
]
ok(
	'env kosong → daftar default lengkap (6 origin UI + "null")',
	JSON.stringify(defaults) === JSON.stringify(EXPECTED_DEFAULTS),
	JSON.stringify(defaults),
)
ok(
	'setiap origin default DIIZINKAN',
	EXPECTED_DEFAULTS.every((origin) => isOriginAllowed(origin, defaults)),
	JSON.stringify(
		defaults.filter((origin) => !EXPECTED_DEFAULTS.includes(origin)),
	),
)
ok(
	'"null" (Electron file://) cocok dengan default',
	isOriginAllowed('null', defaults) === true,
)
ok(
	'origin jahat DITOLAK',
	[
		'https://evil.example',
		'http://localhost:5176',
		'http://127.0.0.1:8000',
		'null2',
	].every((origin) => isOriginAllowed(origin, defaults) === false),
)
ok(
	'request tanpa header Origin (curl / server-to-server) diizinkan',
	isOriginAllowed(undefined, defaults) === true,
)

const custom = parseCorsOrigins(
	'https://app.example.com, https://staging.example.com',
)
ok(
	'RPC_CORS_ORIGINS custom dihormati apa adanya (2 entri, spasi dibersihkan)',
	custom.length === 2 &&
		custom[0] === 'https://app.example.com' &&
		custom[1] === 'https://staging.example.com',
	JSON.stringify(custom),
)
ok(
	'daftar custom: origin jahat & "null" DITOLAK (bukan default lagi)',
	isOriginAllowed('https://evil.example', custom) === false &&
		isOriginAllowed('null', custom) === false &&
		isOriginAllowed('https://app.example.com', custom) === true,
)
ok(
	'env kosong ("" / whitespace) jatuh ke daftar default, bukan deny-all',
	parseCorsOrigins('').length === EXPECTED_DEFAULTS.length &&
		parseCorsOrigins('   ').length === EXPECTED_DEFAULTS.length,
)

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
