/**
 * Crypto Web Worker — Heavy cryptographic operations offloaded from main thread.
 *
 * Handles:
 *   - PBKDF2 (encryptSecret / decryptSecret)
 *   - BIP39 mnemonic → seed → BIP32 key derivation
 *   - Transaction signing (secp256k1 via elliptic)
 *
 * Communication: postMessage with request/response pattern using correlation IDs.
 */

// Buffer polyfill — WAJIB: bip39 memanggil Buffer.from/isBuffer.
// Worker punya context terpisah dari main thread, jadi polyfill di main.tsx TIDAK berlaku di sini.
import { Buffer } from 'buffer'

const g = globalThis as { Buffer?: typeof Buffer }
if (typeof g.Buffer === 'undefined') {
	g.Buffer = Buffer
}

import { encryptSecret, decryptSecret } from 'src/client/wallet/vaultCrypto'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { signTransaction } from 'src/crypto/signTransaction'
import type { TxInterface } from 'src/types/transaction'
import type { EncryptedBlob } from 'src/client/wallet/vaultCrypto'

// ---- Types ----

interface WorkerRequest<T = any> {
	id: string
	type: WorkerRequestType
	payload: T
}

type WorkerRequestType =
	'ENCRYPT_SECRET' | 'DECRYPT_SECRET' | 'DERIVE_KEYS' | 'SIGN_TRANSACTION'

interface WorkerResponse<T = any> {
	id: string
	/**
	 * 'PROGRESS' = pesan tambahan SELAMA operasi berjalan (bukan hasil);
	 * tipe lain = balasan final yang me-resolve/men-reject promise.
	 */
	type: WorkerRequestType | 'PROGRESS'
	success?: boolean
	result?: T
	error?: string
	/** Hanya pada type 'PROGRESS': fraksi 0..1. */
	progress?: number
	/** Hanya pada type 'PROGRESS': tipe operasi asli (untuk label UI). */
	op?: WorkerRequestType
}

type EncryptPayload = {
	secret: string
	passphrase: string
	iterations?: number
}
type DecryptPayload = { blob: EncryptedBlob; passphrase: string }
type DeriveKeysPayload = { mnemonic: string }
type SignTxPayload = { unsignedTx: TxInterface; privateKey: string }

// ---- Request Handlers ----

/** Laporkan progres 0..1 ke main thread (lihat router di bawah). */
type ProgressReport = (fraction: number) => void

const handleEncryptSecret = async (
	payload: EncryptPayload,
	report?: ProgressReport,
): Promise<EncryptedBlob> => {
	return encryptSecret(
		payload.secret,
		payload.passphrase,
		payload.iterations,
		undefined,
		report,
	)
}

const handleDecryptSecret = async (
	payload: DecryptPayload,
	report?: ProgressReport,
): Promise<string> => {
	return decryptSecret(payload.blob, payload.passphrase, undefined, report)
}

const handleDeriveKeys = async (
	payload: DeriveKeysPayload,
): Promise<{
	privateKey: string
	publicKey: string
	address: string
	mnemonic: string
}> => {
	// Normalisasi mnemonic (defense in depth: vault sudah normalisasi, tapi worker juga)
	const normalized = payload.mnemonic.trim().replace(/\s+/g, ' ')

	const derived = generateKeysFromMnemonic(normalized)
	// generateKeysFromMnemonic returns { privateKey: 'Nx...', publicKey: 'Nx...' }
	// We need address derived from publicKey (without Nx prefix)
	const { generateAddressFromPublicKey } = await import('src/crypto/generateAddressFromPublicKey')
	const address = generateAddressFromPublicKey(derived.publicKey.slice(2))
	return {
		privateKey: derived.privateKey,
		publicKey: derived.publicKey,
		address,
		mnemonic: normalized,
	}
}

const handleSignTransaction = async (
	payload: SignTxPayload,
): Promise<TxInterface> => {
	return signTransaction(payload.unsignedTx, payload.privateKey)
}

// ---- Message Router ----

const handlers: Record<
	WorkerRequestType,
	(payload: any, report?: ProgressReport) => Promise<any>
> = {
	ENCRYPT_SECRET: handleEncryptSecret,
	DECRYPT_SECRET: handleDecryptSecret,
	DERIVE_KEYS: handleDeriveKeys,
	SIGN_TRANSACTION: handleSignTransaction,
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const { id, type, payload } = event.data

	if (!handlers[type]) {
		const response: WorkerResponse = {
			id,
			type,
			success: false,
			error: `Unknown request type: ${type}`,
		}
		self.postMessage(response)
		return
	}

	try {
		const report: ProgressReport = (fraction) => {
			self.postMessage({
				id,
				type: 'PROGRESS',
				op: type,
				progress: fraction,
			} satisfies WorkerResponse)
		}
		const result = await handlers[type](payload, report)
		const response: WorkerResponse = {
			id,
			type,
			success: true,
			result,
		}
		self.postMessage(response)
	} catch (error) {
		const response: WorkerResponse = {
			id,
			type,
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
		self.postMessage(response)
	}
}

// Signal ready
self.postMessage({ type: 'READY' } as any)

export {} // Make this a module
