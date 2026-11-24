import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction as signSync } from 'src/crypto/signTransaction'
import { stringToHex } from 'src/core/encoding/hex/stringToHex'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { isNexu } from 'src/core/token/isNexu'
import { toNexu } from 'src/core/token/toNexu'
import { validateTransactionFees } from 'src/core/validation/module/isValidTxFee'
import type { TxInterface } from 'src/types/transaction'

/** Lantai biaya: wire tx paling ramping berukuran 96 byte. */
export const MIN_WIRE_FEE_NEXU = 96
const AUTO_FEE_SEED_NEXU = 100
const AUTO_FEE_MAX_ITERATIONS = 4

export type TxSigner = (
	tx: TxInterface,
	key: string,
) => TxInterface | Promise<TxInterface>

export interface SendForm {
	receiver: string
	/** NXC, converted to nexu with string arithmetic. */
	amountNxc: string
	message?: string
}

export interface SendErrors {
	receiver?: string
	amount?: string
}

export interface BuildResult {
	ok: boolean
	tx?: TxInterface
	fee?: number
	error?: string
}

export const validateSendForm = (
	form: SendForm,
	sender: string,
	availableNexu?: number,
): SendErrors => {
	const errors: SendErrors = {}
	const receiver = form.receiver.trim()
	if (!isValidAddress(receiver)) {
		errors.receiver = 'Invalid address (NxC + 40 hex).'
	} else if (receiver === sender) {
		errors.receiver = 'Sender and recipient must be different.'
	}

	let nexu = 0
	let parseError: string | undefined
	try {
		// "10.000" in the UI means ten thousand, not 10 NXC.
		if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(form.amountNxc.trim())) {
			throw new Error('do not use thousands separators in the amount field')
		}
		nexu = toNexu(form.amountNxc)
	} catch (error) {
		parseError = error instanceof Error ? error.message : String(error)
	}

	if (parseError !== undefined) {
		errors.amount = `Invalid amount: ${parseError}.`
	} else if (nexu <= 0) {
		errors.amount = 'Amount must be greater than 0.'
	} else if (!isNexu(nexu)) {
		errors.amount = 'Amount is outside the safe range.'
	} else if (
		availableNexu !== undefined &&
		Number.isSafeInteger(availableNexu) &&
		nexu > availableNexu - MIN_WIRE_FEE_NEXU
	) {
		errors.amount = 'Amount exceeds available balance.'
	}
	return errors
}

const messageData = (form: SendForm) =>
	form.message?.trim() ? { data: stringToHex(form.message.trim()) } : {}

/**
 * Build and sign with the fee as a fixed point: `fee === wire size`.
 * `sign` is injected so the gate uses the same synchronous path as the UI.
 */
export const buildSignedTransaction = async (
	form: SendForm,
	sender: string,
	privateKey: string,
	nonce: number,
	sign: TxSigner = signSync,
): Promise<BuildResult> => {
	const errors = validateSendForm(form, sender)
	if (Object.keys(errors).length > 0) {
		return {
			ok: false,
			error: Object.values(errors).filter(Boolean).join(' '),
		}
	}

	const amount = toNexu(form.amountNxc)
	let fee = AUTO_FEE_SEED_NEXU
	for (let i = 0; i < AUTO_FEE_MAX_ITERATIONS; i++) {
		const unsigned = createUnsignedTransaction(
			{
				receiver: form.receiver.trim(),
				format: 'nexu',
				sender,
				amount,
				fee,
				...messageData(form),
			},
			nonce,
		)
		if (!unsigned.status || !unsigned.tx) {
			return {
				ok: false,
				error: unsigned.error ?? 'Could not build the transaction.',
			}
		}

		let tx: TxInterface
		try {
			tx = await sign(unsigned.tx, privateKey)
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof Error
						? error.message
						: 'Could not sign the transaction.',
			}
		}

		const size = encodeTxPayload(tx).length
		if (fee === size) {
			if (!validateTransactionFees(tx)) {
				return {
					ok: false,
					error: 'Automatic fee failed internal validation (fail-closed).',
				}
			}
			return { ok: true, tx, fee }
		}
		fee = size
	}
	return { ok: false, error: 'Automatic fee did not converge.' }
}

/** RBF: SAME nonce, 2x fee. The rate must be higher than the old tx. */
export const bumpFee = async (
	tx: TxInterface,
	sender: string,
	privateKey: string,
	sign: TxSigner = signSync,
): Promise<BuildResult> => {
	if (tx.from !== sender) return { ok: false, error: 'Not your transaction.' }
	if (!Number.isSafeInteger(tx.fee) || tx.fee <= 0) {
		return { ok: false, error: 'Transaction fee could not be read.' }
	}
	const fee = tx.fee * 2
	const unsigned = createUnsignedTransaction(
		{
			receiver: tx.receiver,
			format: 'nexu',
			sender,
			amount: tx.amount,
			fee,
			...(tx.data === undefined ? {} : { data: tx.data }),
		},
		tx.nonce,
	)
	if (!unsigned.status || !unsigned.tx) {
		return {
			ok: false,
			error: unsigned.error ?? 'Could not build the replacement transaction.',
		}
	}

	let bumped: TxInterface
	try {
		bumped = await sign(unsigned.tx, privateKey)
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: 'Could not sign the transaction.',
		}
	}
	if (!validateTransactionFees(bumped)) {
		return { ok: false, error: 'Fee pengganti gagal validasi internal.' }
	}
	return { ok: true, tx: bumped, fee }
}
