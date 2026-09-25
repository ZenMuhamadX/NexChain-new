import { NXC_DECIMALS } from './constants'

/**
 * Pola desimal kanonik: [sign] bilangan bulat [. desimal] [e eksponen].
 * Tanpa pemisah ribuan, tanpa nol depan, tanpa kosong di tengah.
 *
 * Bagian bulat memakai `(0|[1-9]\d*)` supaya `"007"` DITOLAK — hanya ada
 * satu representasi string per nilai, sehingga input tidak bisa dimanipulasi
 * jadi berbeda-beda untuk nilai yang sama.
 */
const DECIMAL_PATTERN =
	/^([+-])?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d{1,9}))?$/

/** Batas pergeseran titik desimal — penjaga terhadap input ekstrem. */
const MAX_SHIFT = 1_000_000

/**
 * Konversi NXC → nexu **tanpa satu pun operasi floating point**.
 *
 * ========================================================================
 * MENGAPA BUKAN `nxc * 10 ** 8`
 * ========================================================================
 * `0.00025 * 1e8` menempuh jalur IEEE-754 dan TIDAK dijamin menghasilkan
 * bilangan bulat tepat. `String(0.1 + 0.2)` bahkan menghasilkan
 * `"0.30000000000000004"` — mengalikan itu akan menghasilkan nilai yang
 * salah tanpa error apa pun.
 *
 * Fungsi ini murni aritmetika STRING: memisahkan mantisa dan eksponen,
 * lalu menggeser titik desimal dengan cara menyambung/memotong nol.
 * Hasilnya eksak di semua platform dan di semua nilai dalam rentang.
 *
 * ========================================================================
 * ATURAN
 * ========================================================================
 * - Input `number` dinormalisasi lewat `String()` (representasi terpendek
 *   yang round-trip), sehingga literal seperti `0.00025` diterima apa
 *   adanya.
 * - Eksponensial (`"1e-8"`) DITERIMA dan dipetakan tepat: `String(1e-8)`
 *   menghasilkan bentuk eksponensial, dan 1e-8 NXC = 1 nexu yang valid.
 * - Hasilnya harus berupa **bilangan bulat aman yang utuh**. NXC yang
 *   tidak habis dibagi 1 nexu (mis. `0.000000001` = 0.1 nexu) DITOLAK.
 *   Ekor desimal yang semuanya nol tetap diterima karena nilainya memang
 *   utuh (`"0.000000100"` = 10 nexu).
 * - `NaN`, `Infinity`, string kosong, dan angka yang tidak aman DITOLAK.
 *
 * Tidak memvalidasi rentang suplai — gunakan `isNexuCapped` /
 * `isNexu` untuk itu. Fungsi ini murni penerjemah satuan.
 *
 * @param input Nilai NXC berupa string (disarankan) atau number.
 * @returns Nilai dalam nexu, bilangan bulat aman.
 * @throws Error bila bukan desimal yang bisa direpresentasikan utuh.
 */
export const parseNxc = (input: string | number): number => {
	const raw = typeof input === 'number' ? String(input) : input.trim()
	const match = DECIMAL_PATTERN.exec(raw)

	if (!match) {
		throw new Error(`Nilai NXC tidak valid: "${raw}"`)
	}

	const [, sign, intPart, fracPart = '', expPart] = match
	const fracLength = fracPart.length

	// Eksponen datang dari regex (maks 9 digit) sehingga selalu aman, tapi
	// tetap diverifikasi — pertahanan terhadap perubahan pola di kemudian hari.
	const exponent = expPart === undefined ? 0 : Number(expPart)
	if (!Number.isSafeInteger(exponent)) {
		throw new Error(`Nilai NXC tidak valid: "${raw}" (eksponen ekstrem)`)
	}

	// Nilai = digits × 10^(eksponen − panjangDesimal)
	// Nexu  = nilai × NEXU_PER_NXC = digits × 10^(eksponen − panjangDesimal + NXC_DECIMALS)
	const digits = `${intPart}${fracPart}`
	const shift = exponent - fracLength + NXC_DECIMALS

	if (!Number.isSafeInteger(shift) || Math.abs(shift) > MAX_SHIFT) {
		throw new Error(`Nilai NXC tidak valid: "${raw}" (skala ekstrem)`)
	}

	const scaled = shift >= 0 ? scaleUp(digits, shift) : scaleDown(digits, -shift, raw)
	const trimmed = scaled.replace(/^0+(?=\d)/, '')

	// "" berarti semua nol → nol.
	const value = trimmed === '' ? 0 : Number(trimmed)

	if (!Number.isSafeInteger(value)) {
		throw new Error(
			`Nilai NXC tidak valid: "${raw}" — di luar rentang bilangan bulat aman`,
		)
	}

	return sign === '-' ? -value : value
}

/** `digits × 10^n` — sambungkan n nol di belakang. */
const scaleUp = (digits: string, n: number): string => {
	return `${digits}${'0'.repeat(n)}`
}

/**
 * `digits ÷ 10^n` — hanya boleh bila hasilnya UTUH.
 *
 * Ini penyaring "lebih dari NXC_DECIMALS desimal": pecahan yang sisa
 * setelah pembagian bukan nol berarti nilainya bukan kelipatan bulat
 * satu nexu, sehingga tidak bisa disimpan on-chain.
 */
const scaleDown = (digits: string, n: number, raw: string): string => {
	if (n > digits.length) {
		// Lebih kecil dari 10^-n — hanya utuh bila seluruhnya nol.
		if (/^0+$/.test(digits)) return '0'
		throw new Error(
			`Nilai NXC "${raw}" terlalu kecil: bukan kelipatan bulat 1 nexu`,
		)
	}

	const tail = digits.slice(digits.length - n)
	if (!/^0+$/.test(tail)) {
		throw new Error(
			`Nilai NXC "${raw}" memiliki desimal melebihi ${NXC_DECIMALS} ` +
				`(atau tidak habis dibagi 1 nexu)`,
		)
	}
	return digits.slice(0, digits.length - n)
}
