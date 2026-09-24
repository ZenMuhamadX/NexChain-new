import { createUnsignedTransaction } from 'client/lib/createUnsignedTransaction'
import { clientSideTxValidate } from 'client/lib/clientValidateTx'
import { signTransaction } from 'sign/signTransaction'
import { isValidAddress } from 'nexchain/transaction/utils/isValidAddress'
import { toNexu } from 'nexchain/nexucoin/toNexu'
import { isNexu } from 'nexchain/nexucoin/isNexu'
import { generateTimestampz } from 'nexchain/lib/generateTimestampz'
import type { comTxInterface } from 'interface/structComTx'
import type { TxInterface } from 'interface/structTx'
import { fetchNextNonce, sendRawTransaction } from './rpc'
import { cryptoWorker } from '@/hooks/useCryptoWorker'

/** Default fee transaksi — konsisten dengan CLI (satuan nexu). */
export const DEFAULT_FEE_NEXU = 5000

export interface SendForm {
	receiver: string
	/** Jumlah dalam NXC (format 'NXC' → dikonversi `toNexu` di komposisi). */
	amountNxc: string
	/** Fee dalam NEXU. */
	feeNexu: string
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
 * Aturan yang diterapkan (sumber: `interface/module/isValid*`, Joi
 * `txInterfaceValidator`, dan CLI `inquirer/transfer.ts`):
 *
 *   - alamat    : `isValidAddress` (prefix NxC/NxS, panjang 43) —
 *                 validateAddresses + validateAddressLengths
 *   - pengirim ≠ penerima — validateTransactionSenderReceiver
 *   - jumlah    : > 0, konversi ke nexu harus bilangan bulat ≥ 1
 *                 (validateTransactionAmount + isNexu + Joi min 0.999 +
 *                  MIN_AMOUNT_NEXU)
 *   - fee       : angka ≥ 0, dan fee ≤ jumlah(nexu) — validateTransactionFees
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

	const amount = Number(form.amountNxc)
	if (!Number.isFinite(amount) || amount <= 0) {
		errors.amount = 'Jumlah harus lebih dari 0.'
	} else {
		const nexu = toNexu(amount) // rumus identik dengan node/CLI
		if (!isNexu(nexu)) {
			errors.amount = 'Jumlah harus kelipatan 1 nexu (maksimal 18 desimal).'
		} else if (nexu < 1) {
			errors.amount = 'Jumlah minimal 1 nexu.'
		}
	}

	const fee = Number(form.feeNexu)
	if (!Number.isFinite(fee) || fee < 0) {
		errors.fee = 'Fee tidak valid (angka ≥ 0, satuan nexu).'
	} else if (errors.amount === undefined && fee > toNexu(amount)) {
		errors.fee = 'Fee tidak boleh melebihi jumlah transaksi.'
	}

	return errors
}

export interface BuildResult {
	ok: boolean
	tx?: TxInterface
	error?: string
}

/**
 * Susun + tanda tangani transaksi — TANPA I/O (nonce masuk sebagai argumen,
 * persis pola Phase B: `createUnsignedTransaction` murni → `signTransaction`
 * murni). Dipisah dari `sendForm` supaya bisa diuji tanpa node.
 *
 * Versi sinkron (legacy) — gunakan `buildSignedTransactionAsync` untuk non-blocking.
 */
export const buildSignedTransaction = (
	form: SendForm,
	sender: string,
	privateKey: string,
	nonce: number,
): BuildResult => {
	const errors = validateSendForm(form, sender)
	if (hasSendErrors(errors)) {
		const messages = Object.values(errors).filter(Boolean).join(' ')
		return { ok: false, error: messages }
	}

	const comTx: comTxInterface = {
		receiver: form.receiver.trim(),
		format: 'NXC',
		sender,
		amount: Number(form.amountNxc),
		timestamp: generateTimestampz(),
		fee: Number(form.feeNexu),
	}
	if (form.message && form.message.trim().length > 0) {
		comTx.extraMessage = form.message.trim()
	}

	const unsigned = createUnsignedTransaction(comTx, nonce)
	if (!unsigned.status || !unsigned.tx) {
		return { ok: false, error: unsigned.error ?? 'Gagal menyusun transaksi.' }
	}

	try {
		return { ok: true, tx: signTransaction(unsigned.tx, privateKey) }
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'Gagal menandatangani.',
		}
	}
}

/**
 * Async version yang offload signing ke Web Worker (non-blocking main thread).
 * Gunakan ini di production untuk UI yang responsif.
 */
export const buildSignedTransactionAsync = async (
	form: SendForm,
	sender: string,
	privateKey: string,
	nonce: number,
): Promise<BuildResult> => {
	const errors = validateSendForm(form, sender)
	if (hasSendErrors(errors)) {
		const messages = Object.values(errors).filter(Boolean).join(' ')
		return { ok: false, error: messages }
	}

	const comTx: comTxInterface = {
		receiver: form.receiver.trim(),
		format: 'NXC',
		sender,
		amount: Number(form.amountNxc),
		timestamp: generateTimestampz(),
		fee: Number(form.feeNexu),
	}
	if (form.message && form.message.trim().length > 0) {
		comTx.extraMessage = form.message.trim()
	}

	const unsigned = createUnsignedTransaction(comTx, nonce)
	if (!unsigned.status || !unsigned.tx) {
		return { ok: false, error: unsigned.error ?? 'Gagal menyusun transaksi.' }
	}

	try {
		// Sign di Web Worker (non-blocking)
		const signedTx = await cryptoWorker.signTransaction(unsigned.tx, privateKey)
		return { ok: true, tx: signedTx }
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'Gagal menandatangani (worker).',
		}
	}
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
 *     → susun+tanda tangan (murni)
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
		const built = await buildSignedTransactionAsync(form, sender, privateKey, nonce)
		if (!built.ok || !built.tx) {
			return { ok: false, error: built.error ?? 'Gagal menyusun transaksi.' }
		}

		if (!(await clientSideTxValidate(built.tx))) {
			return {
				ok: false,
				error:
					'Validasi client menolak transaksi — cek jumlah/fee/saldo, atau lihat detail di konsol browser.',
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
			error: error instanceof Error ? error.message : 'Gagal mengirim transaksi.',
		}
	}
}
