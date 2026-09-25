/**
 * Gerbang regresi "guard plafon suplai 50 juta NXC bersifat gagal-dulu".
 *
 * Jalankan:  bun run check:cap
 *
 * Yang diverifikasi:
 *   1. konstanta satuan konsisten dan aman untuk aritmetika `number`;
 *   2. `assertNexuCapped` menerima tepat batas plafon, menolak batas+1;
 *   3. penjaga di titik TULIS menolak nilai rusak SEBELUM menyentuh DB —
 *      dan yang penting: `putAccount`/`setPendingBalance` punya `catch`
 *      yang menelan error, jadi guard harus berada di LUAR `try`. Bila
 *      guard salah tempat, tes ini tetap "melempar" tetapi karena alasan
 *      salah — karena itu setiap tes memeriksa PESAN errornya.
 *
 * Skrip ini sengaja TIDAK pernah menulis storage. Nilai yang valid tidak
 * diuji lewat `putAccount` (akan membuka LevelDB dan berebut kunci dengan
 * node yang sedang hidup) — arah "menerima nilai sah" dicakup murni oleh
 * `assertNexuCapped` di `check:amount`.
 */
import { putAccount } from 'account/balance/putAccount'
import { setPendingBalance } from 'nexchain/transaction/setPendingBalance'
import { structBalance } from 'interface/structBalance'
import {
	assertUnitConstants,
	MAX_SUPPLY_NEXU,
	MAX_SUPPLY_NXC,
	MAX_SAFE_NXC,
	NEXU_PER_NXC,
	NXC_DECIMALS,
} from 'nexchain/nexucoin/constants'
import { assertNexuCapped } from 'nexchain/nexucoin/isNexuCapped'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? '  -> ' + extra : ''}`)
	}
}

/** Panggil `fn`, kembalikan `Error` yang dilempar, atau null bila tidak. */
const caught = (fn: () => unknown): Error | null => {
	try {
		void fn()
		return null
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error))
	}
}

/** Sama seperti `caught`, tapi untuk pemanggilan asinkron. */
const caughtAsync = async (
	fn: () => Promise<unknown>,
): Promise<Error | null> => {
	try {
		await fn()
		return null
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error))
	}
}

/**
 * Ambil pesan error; `null` berarti TIDAK melempar.
 * Kembalian string memudahkan pemeriksaan "melempar karena alasan benar".
 */
const messageOf = (error: Error | null): string | null =>
	error === null ? null : error.message

console.log('STAGE 3 — konstanta & guard plafon suplai:')

let unitError: Error | null = null
try {
	assertUnitConstants()
} catch (error) {
	unitError = error instanceof Error ? error : new Error(String(error))
}
ok('assertUnitConstants() lolos untuk nilai proyek', unitError === null, messageOf(unitError) ?? '')

ok('NXC_DECIMALS === 8', NXC_DECIMALS === 8, `got=${NXC_DECIMALS}`)
ok('NEXU_PER_NXC === 100_000_000', NEXU_PER_NXC === 100_000_000, `got=${NEXU_PER_NXC}`)
ok('MAX_SUPPLY_NXC === 50_000_000', MAX_SUPPLY_NXC === 50_000_000, `got=${MAX_SUPPLY_NXC}`)
ok(
	'MAX_SUPPLY_NEXU === MAX_SUPPLY_NXC × NEXU_PER_NXC',
	MAX_SUPPLY_NEXU === MAX_SUPPLY_NXC * NEXU_PER_NXC,
	`got=${MAX_SUPPLY_NEXU}`,
)
ok('MAX_SUPPLY_NEXU === 5e15', MAX_SUPPLY_NEXU === 5_000_000_000_000_000, `got=${MAX_SUPPLY_NEXU}`)
ok(
	'plafon lebih rendah dari batas aman `number` (guard cap lebih dulu)',
	MAX_SUPPLY_NEXU < Number.MAX_SAFE_INTEGER,
)
ok(
	'plafon NXC di bawah batas aman NXC (headroom ≥ 1×)',
	MAX_SUPPLY_NXC < MAX_SAFE_NXC,
	`cap=${MAX_SUPPLY_NXC}, safe=${MAX_SAFE_NXC}`,
)

console.log('STAGE 3 — assertNexuCapped (murni, tanpa I/O):')

ok(
	'assertNexuCapped(MAX_SUPPLY_NEXU) diterima',
	caught(() => assertNexuCapped(MAX_SUPPLY_NEXU, 'gate')) === null,
)
ok(
	'assertNexuCapped(MAX_SUPPLY_NEXU + 1) DITOLAK',
	caught(() => assertNexuCapped(MAX_SUPPLY_NEXU + 1, 'gate')) !== null,
)
ok(
	'assertNexuCapped(1e20) DITOLAK (unsafe integer)',
	caught(() => assertNexuCapped(1e20, 'gate')) !== null,
)
ok(
	'assertNexuCapped(-1) DITOLAK',
	caught(() => assertNexuCapped(-1, 'gate')) !== null,
)

console.log('STAGE 3 — putAccount (choke point penulisan saldo):')

const ADDR = `NxC${'ab'.repeat(20)}`
const balanceWith = (balance: number): structBalance => ({
	address: ADDR,
	balance,
	transactionCount: 0,
	lastTransactionDate: null,
	nonce: 0,
	isContract: false,
})

/**
 * Guard ada di LUAR `try`. Bila seseorang memindahkannya ke dalam `try`,
 * `handleUnexpectedError` akan menelannya dan fungsi kembali normal —
 * `caughtAsync` lalu bernilai `null` sehingga tes gagal. Itulah gunanya
 * memeriksa "melempar" dan bukan hanya "nilai tidak tersimpan".
 *
 * Pesan diperiksa supaya penolakan berasal dari guard, bukan dari penolakan
 * DB / TypeError tak terduga di belakangnya.
 */
const expectReject = async (
	label: string,
	fn: () => Promise<unknown>,
): Promise<void> => {
	const error = await caughtAsync(fn)
	const message = messageOf(error)
	ok(
		`${label} DITOLAK gagal-dulu`,
		error !== null && message !== null && message.includes('rentang aman'),
		message ?? '(tidak melempar — guard tertelan catch?)',
	)
}

await expectReject(
	'putAccount: balance = plafon+1',
	() => putAccount(ADDR, balanceWith(MAX_SUPPLY_NEXU + 1)),
)
await expectReject(
	'putAccount: balance negatif',
	() => putAccount(ADDR, balanceWith(-1)),
)
await expectReject(
	'putAccount: balance unsafe (1e20)',
	() => putAccount(ADDR, balanceWith(1e20)),
)
await expectReject(
	'putAccount: balance NaN',
	() => putAccount(ADDR, balanceWith(Number.NaN)),
)

console.log('STAGE 3 — setPendingBalance (reserve mempool):')

await expectReject(
	'setPendingBalance: pendingAmount = plafon+1',
	() =>
		setPendingBalance({
			address: ADDR,
			pendingAmount: MAX_SUPPLY_NEXU + 1,
		}),
)
await expectReject(
	'setPendingBalance: pendingAmount negatif',
	() => setPendingBalance({ address: ADDR, pendingAmount: -1 }),
)
await expectReject(
	'setPendingBalance: pendingAmount unsafe (1e20)',
	() => setPendingBalance({ address: ADDR, pendingAmount: 1e20 }),
)

console.log('')
console.log(`============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
