import { useEffect, useRef, useState, useCallback } from 'react'
import type { TxInterface } from 'interface/structTx'
import type { comTxInterface } from 'interface/structComTx'
import { getCryptoTimeout } from '@/lib/deviceCrypto'

// ---- UUID Fallback (crypto.randomUUID not available in all browsers) ----
const generateId = (): string => {
  // Try native crypto.randomUUID first (modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
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
  | 'ENCRYPT_SECRET'
  | 'DECRYPT_SECRET'
  | 'DERIVE_KEYS'
  | 'SIGN_TRANSACTION'
  | 'CREATE_UNSIGNED_TX'

interface WorkerResponse<T = any> {
  id: string
  type: WorkerRequestType
  success: boolean
  result?: T
  error?: string
}

export interface EncryptedBlob {
  version: number
  kdf: string
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export interface DerivedKeys {
  privateKey: string
  publicKey: string
  address: string
  mnemonic: string
}

// Use actual TxInterface from codebase
export type UnsignedTx = TxInterface

export type ComTx = comTxInterface

// ---- Hook ----

export const useCryptoWorker = () => {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>>(new Map())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize worker
  useEffect(() => {
    // Create worker - Vite will handle the import as a separate entry point
    const worker = new Worker(new URL('../workers/crypto.worker.ts', import.meta.url), {
      type: 'module',
    })

    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, type, success, result, error: err } = event.data

      // Handle READY signal
      if (type === 'READY' as any) {
        setReady(true)
        return
      }

      const pending = pendingRef.current.get(id)
      if (pending) {
        pendingRef.current.delete(id)
        if (success) {
          pending.resolve(result)
        } else {
          pending.reject(new Error(err ?? `${type} failed`))
        }
      }
    }

    worker.onerror = (err) => {
      setError(`Worker error: ${err.message}`)
      console.error('[CryptoWorker] Error:', err)
    }

    return () => {
      worker.terminate()
      workerRef.current = null
      setReady(false)
    }
  }, [])

  // Generic request function
  const request = useCallback(<T,>(type: WorkerRequestType, payload: any): Promise<T> => {
    return new Promise((resolve, reject) => {
      const worker = workerRef.current
      if (!worker) {
        reject(new Error('Worker not initialized'))
        return
      }
      if (!ready) {
        reject(new Error('Worker not ready'))
        return
      }

      const id = generateId()
      pendingRef.current.set(id, { resolve, reject })

      worker.postMessage({ id, type, payload } as WorkerRequest)

      // Dynamic timeout based on operation type and device capability
      const timeout = getCryptoTimeout(type === 'ENCRYPT_SECRET' || type === 'DECRYPT_SECRET' ? 'ENCRYPT' : type === 'DERIVE_KEYS' ? 'DERIVE' : type === 'SIGN_TRANSACTION' ? 'SIGN' : 'ENCRYPT')
      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id)
          reject(new Error(`${type} timeout after ${timeout}ms`))
        }
      }, timeout)
    })
  }, [ready])

  // ---- Public API ----

  const encryptSecret = useCallback(
    (secret: string, passphrase: string, iterations?: number): Promise<EncryptedBlob> => {
      return request<EncryptedBlob>('ENCRYPT_SECRET', { secret, passphrase, iterations })
    },
    [request]
  )

  const decryptSecret = useCallback(
    (blob: EncryptedBlob, passphrase: string): Promise<string> => {
      return request<string>('DECRYPT_SECRET', { blob, passphrase })
    },
    [request]
  )

  const deriveKeys = useCallback(
    (mnemonic: string): Promise<DerivedKeys> => {
      return request<DerivedKeys>('DERIVE_KEYS', { mnemonic })
    },
    [request]
  )

  const signTransaction = useCallback(
    (unsignedTx: UnsignedTx, privateKey: string): Promise<UnsignedTx> => {
      return request<UnsignedTx>('SIGN_TRANSACTION', { unsignedTx, privateKey })
    },
    [request]
  )

  const createUnsignedTx = useCallback(
    (comTx: ComTx, nonce: number): Promise<UnsignedTx> => {
      return request<UnsignedTx>('CREATE_UNSIGNED_TX', { comTx, nonce })
    },
    [request]
  )

  return {
    ready,
    error,
    encryptSecret,
    decryptSecret,
    deriveKeys,
    signTransaction,
    createUnsignedTx,
  }
}

// ---- Singleton instance for non-React usage (e.g., in vault.ts) ----

let workerSingleton: Worker | null = null
let singletonReady = false
const singletonPending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>()

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
      workerSingleton = new Worker(new URL('../workers/crypto.worker.ts', import.meta.url), {
        type: 'module',
      })

      workerSingleton.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, type, success, result, error: err } = event.data

        if (type === 'READY' as any) {
          singletonReady = true
          resolve()
          return
        }

        const pending = singletonPending.get(id)
        if (pending) {
          singletonPending.delete(id)
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

const singletonRequest = async <T,>(type: WorkerRequestType, payload: any): Promise<T> => {
  await initSingletonWorker()

  const worker = workerSingleton!
  return new Promise((resolve, reject) => {
    const id = generateId()
    singletonPending.set(id, { resolve, reject })

    worker.postMessage({ id, type, payload } as WorkerRequest)

    // Dynamic timeout based on operation type and device capability
    const timeout = getCryptoTimeout(type === 'ENCRYPT_SECRET' || type === 'DECRYPT_SECRET' ? 'ENCRYPT' : type === 'DERIVE_KEYS' ? 'DERIVE' : type === 'SIGN_TRANSACTION' ? 'SIGN' : 'ENCRYPT')
    setTimeout(() => {
      if (singletonPending.has(id)) {
        singletonPending.delete(id)
        reject(new Error(`${type} timeout after ${timeout}ms`))
      }
    }, timeout)
  })
}

export const cryptoWorker = {
  encryptSecret: (secret: string, passphrase: string, iterations?: number): Promise<EncryptedBlob> =>
    singletonRequest<EncryptedBlob>('ENCRYPT_SECRET', { secret, passphrase, iterations }),

  decryptSecret: (blob: EncryptedBlob, passphrase: string): Promise<string> =>
    singletonRequest<string>('DECRYPT_SECRET', { blob, passphrase }),

  deriveKeys: (mnemonic: string): Promise<DerivedKeys> =>
    singletonRequest<DerivedKeys>('DERIVE_KEYS', { mnemonic }),

  signTransaction: (unsignedTx: UnsignedTx, privateKey: string): Promise<UnsignedTx> =>
    singletonRequest<UnsignedTx>('SIGN_TRANSACTION', { unsignedTx, privateKey }),

  createUnsignedTx: (comTx: ComTx, nonce: number): Promise<UnsignedTx> =>
    singletonRequest<UnsignedTx>('CREATE_UNSIGNED_TX', { comTx, nonce }),

  isReady: () => singletonReady,
}