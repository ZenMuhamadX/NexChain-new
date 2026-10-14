import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { clientSideTxValidate } from 'src/client/lib/clientValidateTx'
import { signTransaction } from 'src/crypto/signTransaction'
import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { toNexu } from 'src/core/token/toNexu'
import { isNexu } from 'src/core/token/isNexu'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { validateTransactionFees } from 'src/core/validation/module/isValidTxFee'
import type { comTxInterface } from 'src/types/compositeTransaction'
import type { TxInterface } from 'src/types/transaction'
import { fetchNextNonce, sendRawTransaction } from './rpc'
import { cryptoWorker } from '@/hooks/useCryptoWorker'

/**
 * Lantai biaya minimum: ukuran wire TERKECIL yang pernah terukur untuk
 * transaksi sah, dalam nexu (lantai laju-fee = 1 nexu/byte, jadi biaya
 * minimum = ukuran wire minimum).
 *
 * Asal angka: ukuran wire terukur (payload `encodeTxPayload` = `0x02 ‖
 * rlp(signed)`) untuk transaksi paling ramping — amount 1 nexu, fee 1 nexu,
 * nonce 0, tanpa data — adalah 96 byte. Field lain tidak bisa lebih kecil:
 * nonce 0 dan fee 1 keduanya 1 byte RLP, amount minimal 1 nexu 1 byte, alamat
 * selalu 21 byte, r/s selalu 32 byte masing-masing. Jadi transaksi apa pun
 * berbiaya ≥ 96 nexu, dan jumlah < 96 nexu TIDAK PERNAH bisa menutupi
 * biayanya — ditolak di sini supaya user tidak sampai ke dialog review.
 */
export const MIN_WIRE_FEE_NEXU = 96

/**
 * Fee dihitung otomatis = ukuran wire transaksi (gaya Bitcoin Core; NexChain
 * tidak punya fee market, jadi fee di atas lantai TIDAK memberi prioritas —
 * tidak ada gunanya memilih sendiri). Karena fee ikut di-RLP, fee mengubah
 * ukuran wire-nya sendiri: cari fixed point `fee === encodeTxPayload(tx)
 * .length` lewat iterasi deterministik (lihat `AUTO_FEE_*` di bawah).
 */
export interface SendForm {
	receiver: string
	/** Jumlah dalam NXC (format 'NXC' → dikonversi `toNexu` di komposisi). */
	amountNxc: string
	message?: string
}

export interface SendErrors {
	receiver?: string
	amount?: string
	fee?: string
}

export const hasSendErrors = (errors: SendErrors): boolean =>
	Object.values(errors).some((value) => value !== undefined)

/**
 * Validasi form kirim yang MENCERMINKAN aturan server.
 *
 * Aturan yang diterapkan (sumber: `src/core/validation/module/isValid*` dan
 * Joi `txInterfaceValidator`):
 *
 *   - alamat    : `isValidAddress` (prefix NxC/NxS, panjang 43) —
 *                 validateAddresses + validateAddressLengths
 *   - pengirim ≠ penerima — validateTransactionSenderReceiver
 *   - jumlah    : > 0, parse string eksak via `toNexu` (aritmetika string,
 *                 bukan `Number()`), hasilnya bilangan bulat aman dan
 *                 `isNexu` memverifikasi tidak melebihi plafon suplai
 *                 50.000.000 NXC
 *   - fee       : TIDAK lagi input user — dihitung otomatis saat komposisi
 *                 (fixed point ukuran wire). Yang bisa dicek di sini hanya
 *                 batas bawah mutlak: jumlah harus ≥ `MIN_WIRE_FEE_NEXU`
 *                 (ukuran wire minimum terukur, lihat konstanta), karena
 *                 transaksi apa pun berbiaya minimal sebesar itu.
 *
 * Pemeriksaan saldo, signature, dan nonce TIDAK di sini: `clientSideTxValidate`
 * menjalankan semuanya (dengan RPC live) tepat sebelum broadcast — dan node
 * tetap validator terakhir.
 */
export const validateSendForm = (
	form: SendForm,
	sender: string,
): SendErrors => {
	const errors: SendErrors = {}

	const receiver = form.receiver.trim()
	if (!isValidAddress(receiver)) {
		errors.receiver =
			'Alamat tidak valid (harus diawali NxC/NxS, panjang 43 karakter).'
	} else if (receiver === sender) {
		errors.receiver = 'Pengirim dan penerima tidak boleh sama.'
	}

	// Parse STRING langsung, tanpa `Number(form.amountNxc)` di depannya.
	// `Number()` membulatkan input ke presisi IEEE-754 SEBELUM konversi
	// satuan, sehingga nilai yang tidak representabel lolos sebagai angka
	// non-nol yang tampak valid. `toNexu(string)` bekerja aritmetika
	// string: eksak, dan melempar untuk desimal yang bukan kelipatan
	// bulat 1 nexu (mis. "0.000000001").
	let nexu = 0
	let parseError: string | undefined
	try {
		nexu = toNexu(form.amountNxc)
	} catch (error) {
		parseError = error instanceof Error ? error.message : String(error)
	}

	if (parseError !== undefined) {
		errors.amount = `Jumlah tidak valid — ${parseError}.`
	} else if (nexu <= 0) {
		errors.amount = 'Jumlah harus lebih dari 0.'
	} else if (!isNexu(nexu)) {
		// isNexu sudah mencakup: bilangan bulat aman, ≥ 0, dan
		// ≤ MAX_SUPPLY_NEXU (50.000.000 NXC).
		errors.amount = 'Jumlah di luar rentang aman (maksimal 50.000.000 NXC).'
	} else if (nexu < MIN_WIRE_FEE_NEXU) {
		// Fee otomatis ≥ ukuran wire ≥ 96 nexu, jadi jumlah ini mustahil
		// menutupi biayanya (aturan server: fee ≤ amount menolaknya juga).
		errors.fee = 'Jumlah terlalu kecil untuk menutupi biaya minimal transaksi.'
	}

	return errors
}

export interface BuildResult {
	ok: boolean
	tx?: TxInterface
	error?: string
	/** Fee otomatis yang dipakai (nexu) — sama dengan `tx.fee`. */
	fee?: number
}

/** Seed iterasi fixed-point fee: ukuran wire tx khas ≈ 99–101 byte. */
const AUTO_FEE_SEED_NEXU = 100

/**
 * Maksimal iterasi `fee → ukuran wire(fee) → fee`. Ukuran hanya melompat
 * 1 byte per batas RLP (mis. fee 255 → 256 menambah 1 byte), jadi konvergen
 * dalam ≤ 4 iterasi; gagal konvergen berarti ada yang rusak → fail-closed.
 */
const AUTO_FEE_MAX_ITERATIONS = 4

/** Susun comTx dari form + fee kandidat. `amountNexu` sudah tervalidasi. */
const composeComTx = (
	form: SendForm,
	sender: string,
	fee: number,
	amountNexu: number,
): comTxInterface => {
	const comTx: comTxInterface = {
		receiver: form.receiver.trim(),
		format: 'nexu',
		sender,
		amount: amountNexu,
		fee,
	}
	if (form.message && form.message.trim().length > 0) {
		comTx.data = stringToHex(form.message.trim())
	}
	return comTx
}

/**
 * Selesaikan satu kandidate fee yang SUDAH fixed point (`fee === ukuran
 * wire`): terapkan aturan bisnis fee ≤ jumlah, lalu assert internal lantai
 * laju-fee node (`validateTransactionFees` = 1000 nexu/kB = 1 nexu/byte).
 * Keduanya gagal → fail-closed tanpa tx.
 */
const settleFixedFee = (
	tx: TxInterface,
	fee: number,
	amountNexu: number,
): BuildResult => {
	if (fee > amountNexu) {
		return {
			ok: false,
			error:
				`Jumlah terlalu kecil: biaya minimal ${fee} nexu ` +
				`melebihi jumlah ${amountNexu} nexu.`,
		}
	}
	// Lantai yang sama dengan node. Ukuran wire tx ini = fee (fixed point),
	// jadi assert ini seharusnya tidak pernah gagal — kalau gagal, ada bug
	// di ukuran/encode dan kita menolak alih-alih mengirim tx yang pasti
	// ditolak node.
	if (!validateTransactionFees(tx)) {
		return {
			ok: false,
			error: 'Biaya otomatis gagal validasi internal (fail-closed).',
		}
	}
	return { ok: true, tx, fee }
}

/**
 * Parse + validasi amount form → nexu tervalidasi, atau error digabung.
 * Dipakai ketiga jalur komposisi supaya pesan error identik.
 */
const validatedAmountNexu = (
	form: SendForm,
	sender: string,
): { nexu: number } | { error: string } => {
	const errors = validateSendForm(form, sender)
	if (hasSendErrors(errors)) {
		return { error: Object.values(errors).filter(Boolean).join(' ') }
	}
	// toNexu tidak akan melempar di sini: validateSendForm baru saja
	// membuktikannya valid. Bentuk eksak dipertahankan (tanpa `Number()`).
	return { nexu: toNexu(form.amountNxc) }
}

/**
 * Susun + tanda tangani transaksi dengan fee OTOMATIS — TANPA I/O (nonce
 * masuk sebagai argumen). Fee dicari sebagai fixed point ukuran wire:
 *
 *   fee = 100 (seed) → sign → size = encodeTxPayload(tx).length
 *        → fee === size ? selesai : fee = size, ulangi (maks 4×)
 *
 * Tanda tangan deterministik dan r/s berpanjang tetap (32 byte), jadi
 * ukuran hanya dipengaruhi nilai field — iterasi pasti konvergen, dan tx
 * yang dikembalikan memenuhi `fee === ukuran wire` yang diverifikasi node.
 *
 * Versi sinkron (legacy) — gunakan `buildSignedTransactionAsync` untuk
 * non-blocking.
 */
export const buildSignedTransaction = (
	form: SendForm,
	sender: string,
	privateKey: string,
	nonce: number,
): BuildResult => {
	const amount = validatedAmountNexu(form, sender)
	if ('error' in amount) {
		return { ok: false, error: amount.error }
	}

	let fee = AUTO_FEE_SEED_NEXU
	for (let i = 0; i < AUTO_FEE_MAX_ITERATIONS; i++) {
		const unsigned = createUnsignedTransaction(
			composeComTx(form, sender, fee, amount.nexu),
			nonce,
		)
		if (!unsigned.status || !unsigned.tx) {
			return {
				ok: false,
				error: unsigned.error ?? 'Gagal menyusun transaksi.',
			}
		}

		let tx: TxInterface
		try {
			tx = signTransaction(unsigned.tx, privateKey)
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : 'Gagal menandatangani.',
			}
		}

		const size = encodeTxPayload(tx).length
		if (fee === size) {
			return settleFixedFee(tx, fee, amount.nexu)
		}
		fee = size
	}

	return {
		ok: false,
		error: 'Gagal menghitung biaya otomatis (tidak konvergen) — coba lagi.',
	}
}

/**
 * Async version yang offload signing ke Web Worker (non-blocking main thread).
 * Alur fee otomatis sama persis dengan versi sinkron — hanya `signTransaction`
 * yang diganti jalur worker. Gunakan ini di production untuk UI yang responsif.
 */
export const buildSignedTransactionAsync = async (
	form: SendForm,
	sender: string,
	privateKey: string,
	nonce: number,
): Promise<BuildResult> => {
	const amount = validatedAmountNexu(form, sender)
	if ('error' in amount) {
		return { ok: false, error: amount.error }
	}

	let fee = AUTO_FEE_SEED_NEXU
	for (let i = 0; i < AUTO_FEE_MAX_ITERATIONS; i++) {
		const unsigned = createUnsignedTransaction(
			composeComTx(form, sender, fee, amount.nexu),
			nonce,
		)
		if (!unsigned.status || !unsigned.tx) {
			return {
				ok: false,
				error: unsigned.error ?? 'Gagal menyusun transaksi.',
			}
		}

		let tx: TxInterface
		try {
			// Sign di Web Worker (non-blocking)
			tx = await cryptoWorker.signTransaction(unsigned.tx, privateKey)
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof Error
						? error.message
						: 'Gagal menandatangani (worker).',
			}
		}

		const size = encodeTxPayload(tx).length
		if (fee === size) {
			return settleFixedFee(tx, fee, amount.nexu)
		}
		fee = size
	}

	return {
		ok: false,
		error: 'Gagal menghitung biaya otomatis (tidak konvergen) — coba lagi.',
	}
}

/**
 * Pratinjau fee PERSIS tanpa broadcast — dipanggil UI saat membuka dialog
 * review supaya user melihat biaya yang akan ia tandatangani. Deterministik
 * (tanda tangan ECDSA-nya sendiri deterministik), jadi fee yang dikembalikan
 * sama dengan yang nanti dipakai `buildSignedTransaction*` dengan form,
 * nonce, dan kunci yang sama.
 */
export const previewAutoFee = (
	form: SendForm,
	sender: string,
	privateKey: string,
	nonce: number,
): { ok: boolean; fee?: number; error?: string } => {
	const built = buildSignedTransaction(form, sender, privateKey, nonce)
	if (built.ok && built.fee !== undefined) {
		return { ok: true, fee: built.fee }
	}
	return { ok: false, error: built.error ?? 'Gagal menghitung biaya jaringan.' }
}

export interface SendOutcome {
	ok: boolean
	txHash?: string
	error?: string
}

/**
 * Alur kirim penuh:
 *
 *   nonce (Bug B: `nex_getNextNonce` = akun + pending mempool)
 *     → susun+tanda tangan dengan fee otomatis (murni)
 *     → `clientSideTxValidate` (Joi + signature + saldo live + aturan server)
 *     → `nex_sendRawTransaction`
 *
 * Node tetap validator terakhir; kegagalan apa pun dipetakan ke pesan yang
 * bisa ditampilkan apa adanya.
 */
export const sendForm = async (
	form: SendForm,
	sender: string,
	privateKey: string,
): Promise<SendOutcome> => {
	try {
		const nonce = await fetchNextNonce(sender)
		// Gunakan async version dengan Web Worker untuk signing non-blocking
		const built = await buildSignedTransactionAsync(
			form,
			sender,
			privateKey,
			nonce,
		)
		if (!built.ok || !built.tx) {
			return { ok: false, error: built.error ?? 'Gagal menyusun transaksi.' }
		}

		if (!(await clientSideTxValidate(built.tx))) {
			return {
				ok: false,
				error:
					'Validasi client menolak transaksi — cek jumlah/saldo, atau lihat detail di konsol browser.',
			}
		}

		const result = await sendRawTransaction(built.tx)
		if (!result.status) {
			return { ok: false, error: result.error ?? 'Node menolak transaksi.' }
		}

		const txHash = result.txHash ?? built.tx.txHash ?? ''
		return { ok: true, txHash }
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error ? error.message : 'Gagal mengirim transaksi.',
		}
	}
}
