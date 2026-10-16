import type { TxInterface } from 'src/types/transaction'
import { getCryptoTimeout } from '@/lib/deviceCrypto'
import { publishCryptoProgress } from '@/lib/cryptoProgress'
import type { EncryptedBlob } from 'src/client/wallet/vaultCrypto'

// ---- UUID Fallback (crypto.randomUUID not available in all browsers) ----
const generateId = (): string => {
	// Try native crypto.randomUUID first (modern browsers)
	if (
		typeof crypto !== 'undefined' &&
		typeof crypto.randomUUID === 'function'
	) {
		return crypto.randomUUID()
	}
	// Fallback: RFC4122 v4 compliant UUID
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0
		const v = c === 'x' ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

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

export type { EncryptedBlob } from 'src/client/wallet/vaultCrypto'

export interface DerivedKeys {
	privateKey: string
	publicKey: string
	address: string
	mnemonic: string
}

// Use actual TxInterface from codebase
export type UnsignedTx = TxInterface

// ---- Singleton instance for non-React usage (e.g., in vault.ts) ----

let workerSingleton: Worker | null = null
let singletonReady = false
const singletonPending = new Map<
	string,
	{ resolve: (value: any) => void; reject: (error: Error) => void }
>()

const initSingletonWorker = (): Promise<void> => {
	if (workerSingleton && singletonReady) return Promise.resolve()

	return new Promise((resolve, reject) => {
		if (workerSingleton) {
			// Already initializing, wait for ready
			const checkReady = setInterval(() => {
				if (singletonReady) {
					clearInterval(checkReady)
					resolve()
				}
			}, 50)
			return
		}

		try {
			workerSingleton = new Worker(
				new URL('../workers/crypto.worker.ts', import.meta.url),
				{
					type: 'module',
				},
			)

			workerSingleton.onmessage = (event: MessageEvent<WorkerResponse>) => {
				const {
					id,
					type,
					success,
					result,
					error: err,
					progress,
					op,
				} = event.data

				if (type === ('READY' as any)) {
					singletonReady = true
					resolve()
					return
				}

				// Progres intermediate: sebarkan ke UI tanpa menyelesaikan request
				if (type === 'PROGRESS') {
					if (typeof progress === 'number')
						publishCryptoProgress({ phase: op ?? 'CRYPTO', fraction: progress })
					return
				}

				const pending = singletonPending.get(id)
				if (pending) {
					singletonPending.delete(id)
					// Sinyal selesai agar pill progres sembunyi
					if (type === 'ENCRYPT_SECRET' || type === 'DECRYPT_SECRET') {
						publishCryptoProgress({ phase: type, fraction: 1 })
					}
					if (success) {
						pending.resolve(result)
					} else {
						pending.reject(new Error(err ?? `${type} failed`))
					}
				}
			}

			workerSingleton.onerror = (err) => {
				console.error('[CryptoWorker Singleton] Error:', err)
				reject(new Error(`Worker error: ${err.message}`))
			}
		} catch (err) {
			reject(err)
		}
	})
}

const singletonRequest = async <T>(
	type: WorkerRequestType,
	payload: any,
): Promise<T> => {
	await initSingletonWorker()

	const worker = workerSingleton!
	return new Promise((resolve, reject) => {
		const id = generateId()
		singletonPending.set(id, { resolve, reject })

		worker.postMessage({ id, type, payload } as WorkerRequest)

		// Dynamic timeout based on operation type and device capability
		const timeout = getCryptoTimeout(
			type === 'ENCRYPT_SECRET' || type === 'DECRYPT_SECRET'
				? 'ENCRYPT'
				: type === 'DERIVE_KEYS'
					? 'DERIVE'
					: type === 'SIGN_TRANSACTION'
						? 'SIGN'
						: 'ENCRYPT',
		)
		setTimeout(() => {
			if (singletonPending.has(id)) {
				singletonPending.delete(id)
				if (type === 'ENCRYPT_SECRET' || type === 'DECRYPT_SECRET') {
					publishCryptoProgress({ phase: type, fraction: 1 })
				}
				reject(new Error(`${type} timeout after ${timeout}ms`))
			}
		}, timeout)
	})
}

export const cryptoWorker = {
	encryptSecret: (
		secret: string,
		passphrase: string,
		iterations?: number,
	): Promise<EncryptedBlob> =>
		singletonRequest<EncryptedBlob>('ENCRYPT_SECRET', {
			secret,
			passphrase,
			iterations,
		}),

	decryptSecret: (blob: EncryptedBlob, passphrase: string): Promise<string> =>
		singletonRequest<string>('DECRYPT_SECRET', { blob, passphrase }),

	deriveKeys: (mnemonic: string): Promise<DerivedKeys> =>
		singletonRequest<DerivedKeys>('DERIVE_KEYS', { mnemonic }),

	signTransaction: (
		unsignedTx: UnsignedTx,
		privateKey: string,
	): Promise<UnsignedTx> =>
		singletonRequest<UnsignedTx>('SIGN_TRANSACTION', {
			unsignedTx,
			privateKey,
		}),

	isReady: () => singletonReady,
}
