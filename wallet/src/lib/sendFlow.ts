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
 * Ukuran wire (byte) TERKECIL untuk transaksi sah = lantai biaya fee otomatis
 * wallet (lantai laju-fee node = 1 nexu/byte, jadi fee = ukuran wire).
 *
 * Asal angka: ukuran wire terukur (payload `encodeTxPayload` = `0x02 ‖
 * rlp(signed)`) untuk transaksi paling ramping — amount 1 nexu, fee 1 nexu,
 * nonce 0, tanpa data — adalah 96 byte. Field lain tidak bisa lebih kecil:
 * nonce 0 dan fee 1 keduanya 1 byte RLP, amount minimal 1 nexu 1 byte, alamat
 * selalu 21 byte, r/s selalu 32 byte masing-masing. Jadi transaksi apa pun
 * berbiaya ≥ 96 nexu. A4b: lantai JUMLAH dihapus — jumlah lebih kecil dari
 * biayanya tetap sah (Bitcoin/Ethereum juga begitu); yang menahan
 * penyalahgunaan adalah lantai laju-fee itu sendiri.
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
 *   - alamat    : `isValidAddress` (prefix NxC, panjang 43) -
 *                 validateAddresses + validateAddressLengths
 *   - pengirim ≠ penerima — validateTransactionSenderReceiver
 *   - jumlah    : > 0, parse string eksak via `toNexu` (aritmetika string,
 *                 bukan `Number()`), hasilnya bilangan bulat aman dan
 *                 `isNexu` memverifikasi tidak melebihi plafon suplai
 *                 50.000.000 NXC
 *   - fee       : TIDAK lagi input user — dihitung otomatis saat komposisi
 *                 (fixed point ukuran wire). A4b: lantai JUMLAH dihapus,
 *                 jadi jumlah lebih kecil dari fee tetap sah (total
 *                 `amount + fee` yang ditampilkan UI yang perlu ditanggung
 *                 saldo — diperiksa `clientSideTxValidate`/node).
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
			'Alamat tidak valid (harus diawali NxC, panjang 43 karakter).'
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
 * Selesaikan satu kandidate fee: assert internal kebijakan node
 * (`validateTransactionFees` = lantai laju-fee 1000 nexu/kB = 1 nexu/byte,
 * plus guard fee ≥ 0). Gagal → fail-closed tanpa tx.
 *
 * A4b: lantai JUMLAH ("fee ≤ jumlah") dihapus di sini dan di node — fee di
 * atas nilai transaksi sah.
 *
 * Dipakai dua jalur: fee otomatis (fixed point `fee === ukuran wire`) dan fee
 * EKSPLISIT `bumpPendingFee` (percepat/RBF) yang sengaja di atas lantai —
 * pemeriksaannya sama, jadi keduanya lewat sini.
 */
const settleFixedFee = (tx: TxInterface, fee: number): BuildResult => {
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
			return settleFixedFee(tx, fee)
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
			return settleFixedFee(tx, fee)
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
 * Ekor bersama semua jalur kirim: validasi klien (Rule server + saldo live) →
 * `nex_sendRawTransaction` → pemetaan hasil. Node tetap validator terakhir.
 */
const broadcast = async (tx: TxInterface): Promise<SendOutcome> => {
	if (!(await clientSideTxValidate(tx))) {
		return {
			ok: false,
			error:
				'Validasi client menolak transaksi — cek jumlah/saldo, atau lihat detail di konsol browser.',
		}
	}

	const result = await sendRawTransaction(tx)
	if (!result.status) {
		return { ok: false, error: result.error ?? 'Node menolak transaksi.' }
	}

	const txHash = result.txHash ?? tx.txHash ?? ''
	return { ok: true, txHash }
}

/** Penanda tangan tx — Worker di UI, `signTransaction` sinkron di gate offline. */
export type TxSigner = (
	tx: TxInterface,
	privateKey: string,
) => Promise<TxInterface> | TxInterface

/**
 * Susun + tanda tangani pengganti (RBF): nonce SAMA, jumlah/penerima/data
 * sama, fee dua kali lipat. Tidak menyentuh jaringan — `sign` disuntik supaya
 * gate offline (`wallet/scripts/sendFlowSmoke.ts`) menguji jalur yang sama
 * tanpa Web Worker.
 *
 * Kenapa fee-nya EKSPLISIT: fee otomatis wallet selalu = ukuran wire (laju
 * tepat 1 nexu/byte), sedangkan node menuntut laju pengganti LEBIH tinggi
 * lewat perkalian silang (`replacesFeeRate` di
 * `src/core/transaction/memPool.ts`). Tx auto-fee pada nonce yang sama selalu
 * kalah dan ditolak. Penggandaan selalu menang: `2f·s > f·(s+1)` selama
 * `s > 1`, dan fee yang naik menambah panjang RLP paling banyak 1 byte.
 *
 * `settleFixedFee` menegakkan lantai laju-fee yang sama dengan kirim biasa;
 * A4b: pengganti boleh bernilai fee di atas jumlah transaksi (batas jumlah
 * dihapus di klien dan di node).
 */
export const buildBumpedTransaction = async (
	tx: TxInterface,
	sender: string,
	privateKey: string,
	sign: TxSigner,
): Promise<BuildResult> => {
	if (tx.from !== sender) {
		return {
			ok: false,
			error: 'Hanya transaksi keluar Anda yang bisa dipercepat.',
		}
	}
	const oldFee = tx.fee
	if (!Number.isSafeInteger(oldFee) || oldFee <= 0) {
		return {
			ok: false,
			error:
				'Biaya transaksi tidak terbaca — transaksi ini tidak bisa dipercepat.',
		}
	}
	const newFee = oldFee * 2
	const comTx: comTxInterface = {
		receiver: tx.receiver,
		format: 'nexu',
		sender,
		amount: tx.amount,
		fee: newFee,
		// Sebar bersyarat: field `data` yang absen tetap absen.
		...(tx.data === undefined ? {} : { data: tx.data }),
	}

	const unsigned = createUnsignedTransaction(comTx, tx.nonce)
	if (!unsigned.status || !unsigned.tx) {
		return {
			ok: false,
			error: unsigned.error ?? 'Gagal menyusun transaksi pengganti.',
		}
	}

	let bumped: TxInterface
	try {
		bumped = await sign(unsigned.tx, privateKey)
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'Gagal menandatangani.',
		}
	}

	return settleFixedFee(bumped, newFee)
}

/** Percepat (RBF) tx milik sendiri yang tertunda: bangun pengganti lalu broadcast. */
export const bumpPendingFee = async (
	tx: TxInterface,
	sender: string,
	privateKey: string,
): Promise<SendOutcome> => {
	try {
		const built = await buildBumpedTransaction(
			tx,
			sender,
			privateKey,
			cryptoWorker.signTransaction,
		)
		if (!built.ok || !built.tx) {
			return {
				ok: false,
				error: built.error ?? 'Gagal menyusun transaksi pengganti.',
			}
		}
		return await broadcast(built.tx)
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error ? error.message : 'Gagal mempercepat transaksi.',
		}
	}
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

		return await broadcast(built.tx)
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error ? error.message : 'Gagal mengirim transaksi.',
		}
	}
}
