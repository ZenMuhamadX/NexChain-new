/**
 * `bun run check:amount`
 *
 * Gate untuk satuan NXC (8 desimal) + plafon suplai 50 juta.
 *
 * Yang dijaga di sini:
 *   1. Konversi NXC ↔ nexu EKSAK — tanpa satu pun operasi float.
 *   2. Pemetaan seluruh konstanta jadwal reward/fee ke satuan baru.
 *   3. `formatNxc` tidak pernah menghasilkan "ekor" desimal palsu.
 *   4. `isNexuCapped` menolak semua nilai di luar rentang aman.
 *   5. Plafon suplai masih berada di bawah `Number.MAX_SAFE_INTEGER`.
 */
import {
	MAX_SAFE_NXC,
	MAX_SUPPLY_NEXU,
	MAX_SUPPLY_NXC,
	NEXU_PER_NXC,
	NXC_DECIMALS,
	assertUnitConstants,
} from 'src/core/token/constants'
import { parseNxc } from 'src/core/token/parseNxc'
import { formatNxc, formatNxcWithUnit } from 'src/core/token/formatNxc'
import { assertNexuCapped, isNexuCapped } from 'src/core/token/isNexuCapped'
import { cutBlockReward } from 'src/core/block/distributeBlockReward'

let okCount = 0
let failCount = 0

const ok = (label: string, condition: boolean): void => {
	if (condition) {
		okCount++
		console.log(`  OK   ${label}`)
	} else {
		failCount++
		console.log(`  FAIL ${label}`)
	}
}

/** Bandingkan hasil fungsi dengan nilai eksak, tangkap error. */
const caught = (fn: () => unknown): string | null => {
	try {
		fn()
		return null
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

console.log('STAGE 1 — konstanta satuan & suplai:')

ok('assertUnitConstants() lulus', caught(assertUnitConstants) === null)
ok('NXC_DECIMALS === 8', NXC_DECIMALS === 8)
ok('NEXU_PER_NXC === 100_000_000', NEXU_PER_NXC === 100_000_000)
ok('NEXU_PER_NXC === 10 ** 8', NEXU_PER_NXC === 10 ** NXC_DECIMALS)
ok('MAX_SUPPLY_NXC === 50_000_000', MAX_SUPPLY_NXC === 50_000_000)
ok(
	'MAX_SUPPLY_NEXU === 5_000_000_000_000_000',
	MAX_SUPPLY_NEXU === 5_000_000_000_000_000,
)
ok(
	'MAX_SUPPLY_NEXU === MAX_SUPPLY_NXC × NEXU_PER_NXC',
	MAX_SUPPLY_NEXU === MAX_SUPPLY_NXC * NEXU_PER_NXC,
)
ok('MAX_SUPPLY_NEXU bilangan bulat aman', Number.isSafeInteger(MAX_SUPPLY_NEXU))
ok(
	'MAX_SUPPLY_NEXU < Number.MAX_SAFE_INTEGER',
	MAX_SUPPLY_NEXU < Number.MAX_SAFE_INTEGER,
)
ok(
	'plafon 50 juta masih di bawah kapasitas aman 90.071.992',
	MAX_SUPPLY_NXC <= MAX_SAFE_NXC,
)
ok(
	'headroom ≥ 1.5× (MAX_SAFE_NXC / MAX_SUPPLY_NXC)',
	MAX_SAFE_NXC / MAX_SUPPLY_NXC >= 1.5,
)

console.log('STAGE 1 — parseNxc: konversi eksak (tanpa float):')

// --- Pemetaan seluruh konstanta jadwal reward/fee ke satuan 8 desimal ---
ok('1 NXC = 100_000_000 nexu', parseNxc('1') === 100_000_000)
ok(
	'12.5 NXC (hadiah epoch-0) = 1_250_000_000',
	parseNxc('12.5') === 1_250_000_000,
)
ok('6.25 NXC (hadiah epoch-1) = 625_000_000', parseNxc('6.25') === 625_000_000)
ok('0 NXC (hadiah genesis sejak P2) = 0', parseNxc('0') === 0)
ok('0.5 NXC = 50_000_000', parseNxc('0.5') === 50_000_000)
ok('1 nexu (desimal minimum) = 1', parseNxc('0.00000001') === 1)
ok('10 nexu dari "0.000000100"', parseNxc('0.000000100') === 10)
ok('plafon penuh 50_000_000 NXC', parseNxc('50000000') === MAX_SUPPLY_NEXU)

// --- Input number (literal di kode harus round-trip eksak) ---
ok('parseNxc(12.5) === 1_250_000_000', parseNxc(12.5) === 1_250_000_000)
ok('parseNxc(6.25) === 625_000_000', parseNxc(6.25) === 625_000_000)
ok('parseNxc(0.001) === 100_000', parseNxc(0.001) === 100_000)
ok('parseNxc(50) === 5_000_000_000', parseNxc(50) === 5_000_000_000)
ok('parseNxc(0.5) === 50_000_000', parseNxc(0.5) === 50_000_000)

// --- Bentuk eksponensial: String(1e-8) === "1e-8" ---
ok(
	'parseNxc("1e-8") === 1 (bentuk eksponensial diterima)',
	parseNxc('1e-8') === 1,
)
ok('parseNxc(1e-8) === 1', parseNxc(1e-8) === 1)
ok('parseNxc("1E-7") === 10', parseNxc('1E-7') === 10)

// --- Penolakan: bukan kelipatan bulat 1 nexu ---
ok(
	'0.000000001 DITOLAK (0.1 nexu)',
	caught(() => parseNxc('0.000000001')) !== null,
)
ok(
	'0.0000000001 DITOLAK (0.01 nexu)',
	caught(() => parseNxc('0.0000000001')) !== null,
)
ok(
	'0.1+0.2 = 0.30000000000000004 DITOLAK (bukan kanonik)',
	caught(() => parseNxc(0.1 + 0.2)) !== null,
)
ok('parseNxc(NaN) DITOLAK', caught(() => parseNxc(NaN)) !== null)
ok('parseNxc(Infinity) DITOLAK', caught(() => parseNxc(Infinity)) !== null)
ok('parseNxc("") DITOLAK', caught(() => parseNxc('')) !== null)
ok('parseNxc(" ") DITOLAK', caught(() => parseNxc(' ')) !== null)
ok('parseNxc("abc") DITOLAK', caught(() => parseNxc('abc')) !== null)
ok(
	'parseNxc("1,5") DITOLAK (pemisah ribuan)',
	caught(() => parseNxc('1,5')) !== null,
)
ok('parseNxc("0x10") DITOLAK', caught(() => parseNxc('0x10')) !== null)
ok(
	'parseNxc(".5") DITOLAK (tidak kanonik)',
	caught(() => parseNxc('.5')) !== null,
)
ok(
	'parseNxc("5.") DITOLAK (tidak kanonik)',
	caught(() => parseNxc('5.')) !== null,
)
ok(
	'parseNxc("007") DITOLAK (nol depan)',
	caught(() => parseNxc('007')) !== null,
)
ok(
	'100 juta NXC (di atas plafon) → nexu tidak aman sehingga DITOLAK',
	caught(() => parseNxc('100000000')) !== null,
)
ok(
	'60 juta NXC masih bisa diparse (aman) tapi DI LUAR plafon suplai',
	!isNexuCapped(parseNxc('60000000')),
)
ok(
	'1e21 DITOLAK (di luar rentang bilangan bulat aman)',
	caught(() => parseNxc('1e21')) !== null,
)

// --- Negatif diterima sebagai konverter (rentang dijaga isNexuCapped) ---
ok('parseNxc("-1") === -100_000_000', parseNxc('-1') === -100_000_000)

console.log('STAGE 1 — formatNxc: tanpa ekor desimal palsu:')

ok('formatNxc(100_000_000) === "1"', formatNxc(100_000_000) === '1')
ok('formatNxc(25_000) === "0.00025"', formatNxc(25_000) === '0.00025')
ok('formatNxc(1) === "0.00000001"', formatNxc(1) === '0.00000001')
ok('formatNxc(99_998) === "0.00099998"', formatNxc(99_998) === '0.00099998')
ok('formatNxc(0) === "0"', formatNxc(0) === '0')
ok('formatNxc(-1) === "-0.00000001"', formatNxc(-1) === '-0.00000001')
ok(
	'formatNxc(plafon) === "50000000"',
	formatNxc(MAX_SUPPLY_NEXU) === '50000000',
)

// Bukti utama: saldo bulat TIDAK menghasilkan ekor desimal.
// Sebelum perbaikan, ekspektasi semacam ini gagal dengan
// "100.00049999999901" akibat pembagian float.
const arbitraryIntegers = [
	1, 10, 25_000, 99_998, 100_000, 5_000_000_000, 50_000_000_000,
	5_000_000_000_000_000, 4_999_999_999_999_999, 123_456_789_012_345,
]
let roundTripAll = true
let atMostDecimalsAll = true
for (const value of arbitraryIntegers) {
	const text = formatNxc(value)
	if (parseNxc(text) !== value) {
		roundTripAll = false
		console.log(`    round-trip gagal: ${value} -> "${text}"`)
	}
	// Invarian satuan: tidak pernah lebih dari NXC_DECIMALS digit desimal.
	// Sebelum perbaikan, pembagian float menghasilkan digit tambahan yang
	// tidak pernah ada di state (ekor "9999999").
	const fraction = text.split('.')[1] ?? ''
	if (fraction.length > NXC_DECIMALS) {
		atMostDecimalsAll = false
		console.log(
			`    terlalu banyak desimal (${fraction.length} > ${NXC_DECIMALS}): "${text}"`,
		)
	}
}
ok('round-trip formatNxc → parseNxc untuk 10 bilangan bulat', roundTripAll)
ok(`tidak pernah melebihi ${NXC_DECIMALS} digit desimal`, atMostDecimalsAll)

// Batas representasi: di satuan 8 desimal, SEMUA bilangan bulat aman
// tetap eksak setelah operasi +1 — berbeda dengan satuan 1e18 lama
// di mana `1e18 + 1 === 1e18`.
ok(
	'plafon + 1 masih eksak (5_000_000_000_000_000 + 1)',
	MAX_SUPPLY_NEXU + 1 === MAX_SUPPLY_NEXU + 1 &&
		Number.isSafeInteger(MAX_SUPPLY_NEXU + 1),
)
ok(
	'MAX_SAFE_INTEGER + 1 TIDAK aman (kontras dengan satuan lama)',
	!Number.isSafeInteger(Number.MAX_SAFE_INTEGER + 1),
)

ok(
	'formatNxcWithUnit menambah satuan',
	formatNxcWithUnit(25_000) === '0.00025 NXC',
)
ok(
	'formatNxc dengan maxDecimals=2 memotong ke "0"',
	formatNxc(25_000, 2) === '0',
)
ok(
	'formatNxc dengan maxDecimals=6 memotong ke "0.00025"',
	formatNxc(25_000, 6) === '0.00025',
)
ok('formatNxc menolak non-bulat', caught(() => formatNxc(1.5)) !== null)
ok(
	'formatNxc menolak unsafe',
	caught(() => formatNxc(Number.MAX_SAFE_INTEGER + 1)) !== null,
)

console.log('STAGE 1 — isNexuCapped / assertNexuCapped:')

ok('0 aman', isNexuCapped(0) === true)
ok('1 aman', isNexuCapped(1) === true)
ok('plafon TEPAT aman', isNexuCapped(MAX_SUPPLY_NEXU) === true)
ok('plafon + 1 DITOLAK', isNexuCapped(MAX_SUPPLY_NEXU + 1) === false)
ok('negatif DITOLAK', isNexuCapped(-1) === false)
ok('pecahan DITOLAK', isNexuCapped(1.5) === false)
ok('NaN DITOLAK', isNexuCapped(NaN) === false)
ok('Infinity DITOLAK', isNexuCapped(Infinity) === false)
ok(
	'unsafe integer DITOLAK',
	isNexuCapped(Number.MAX_SAFE_INTEGER + 2) === false,
)
ok('1e20 DITOLAK', isNexuCapped(1e20) === false)

ok(
	'assertNexuCapped lulus untuk nilai aman',
	caught(() => assertNexuCapped(MAX_SUPPLY_NEXU, 'test')) === null,
)
ok(
	'assertNexuCapped melempar untuk plafon+1',
	caught(() => assertNexuCapped(MAX_SUPPLY_NEXU + 1, 'test')) !== null,
)
ok(
	'assertNexuCapped melempar untuk negatif',
	caught(() => assertNexuCapped(-1, 'test')) !== null,
)

console.log('STAGE 3 — jadwal reward vs plafon suplai (simulasi):')

// Pemetaan jadwal halving ke satuan 8 desimal — nilai KONSENSUS.
ok(
	'cutBlockReward(1) = 1_250_000_000 (12.5 NXC)',
	cutBlockReward(1) === 1_250_000_000,
)
ok(
	'cutBlockReward(19) belum berkurang (epoch 0)',
	cutBlockReward(19) === 1_250_000_000,
)
ok(
	'cutBlockReward(2_000_001) = 625_000_000 (halving pertama, 6.25 NXC)',
	cutBlockReward(2_000_001) === 625_000_000,
)
ok(
	'semua reward bilangan bulat aman & ≥ 0 pada 10 ribu blok pertama',
	Array.from({ length: 10_000 }, (_, i) => cutBlockReward(i + 1)).every(
		(r) => Number.isSafeInteger(r) && r >= 0,
	),
)

/**
 * Simulasi akumulasi `totalIssued` — bukti bahwa jadwal reward TIDAK bisa
 * meledak melampaui plafon.
 *
 * Kenapa ini layak diuji: plafon adalah hard invariant yang dijaga per
 * blok, jadi yang perlu dipastikan adalah jadwal reward itu sendiri
 * menghasilkan akumulasi yang tetap berada di bawahnya. Simulasi di sini
 * mengitari epoch 0 (2 juta blok pertama); Σ SELURUH epoch secara
 * closed-form dibuktikan di `check:consensus` (RULE 2b).
 *
 * Setiap penjumlahan memakai dua bilangan bulat < 2^53 dengan hasil juga
 * < 2^53, sehingga penjumlahan float DIJAMIN eksak (tidak ada penumpukan
 * pembulatan).
 */
const SIM_BLOCKS = 2_000_000
let simulatedIssued = 0
let safeIntegerAll = true
for (let height = 1; height <= SIM_BLOCKS; height++) {
	simulatedIssued += cutBlockReward(height)
	if (!Number.isSafeInteger(simulatedIssued)) safeIntegerAll = false
}

const fmtNxc = (value: number): string =>
	(value / NEXU_PER_NXC).toLocaleString('en-US', {
		maximumFractionDigits: 4,
	})

console.log(
	`    S ${SIM_BLOCKS.toLocaleString('en-US')} blok = ` +
		`${simulatedIssued.toLocaleString('en-US')} nexu (${fmtNxc(simulatedIssued)} NXC)`,
)
ok('setiap langkah akumulasi tetap bilangan bulat aman', safeIntegerAll)
ok(
	`S ${SIM_BLOCKS.toLocaleString('en-US')} blok masih di bawah plafon 50.000.000 NXC`,
	simulatedIssued <= MAX_SUPPLY_NEXU,
)

// Epoch-0 saja sudah mencetak 25 juta NXC (setengah plafon) — tiap epoch
// berikutnya menyusut separuhnya sehingga totalnya terbatas (closed-form
// terbukti di check:consensus: Σ = 49.999.999,78 NXC ≤ plafon).
ok(
	'epoch-0 penuh = 25.000.000 NXC (setengah plafon, persis 2 juta blok × 12.5)',
	simulatedIssued === 25_000_000 * 100_000_000,
)
ok(
	'plafon lebih dulu dari batas aman `number` (5e15 < 9,007e15)',
	MAX_SUPPLY_NEXU < Number.MAX_SAFE_INTEGER,
)

console.log(`\n============ ${okCount} OK / ${failCount} FAIL ============`)
process.exit(failCount > 0 ? 1 : 0)
