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

import { encryptSecret, decryptSecret } from 'client/wallet/vaultCrypto'
import { generateKeysFromMnemonic } from 'key/genKeyFromMnemonic'
import { signTransaction } from 'sign/signTransaction'
import { createUnsignedTransaction } from 'client/lib/createUnsignedTransaction'
import type { comTxInterface } from 'interface/structComTx'
import type { TxInterface } from 'interface/structTx'
import type { EncryptedBlob } from 'client/wallet/vaultCrypto'

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

type EncryptPayload = { secret: string; passphrase: string; iterations?: number }
type DecryptPayload = { blob: EncryptedBlob; passphrase: string }
type DeriveKeysPayload = { mnemonic: string }
type SignTxPayload = { unsignedTx: TxInterface; privateKey: string }
type CreateUnsignedTxPayload = { comTx: comTxInterface; nonce: number }

// ---- Request Handlers ----

const handleEncryptSecret = async (payload: EncryptPayload): Promise<EncryptedBlob> => {
  return encryptSecret(payload.secret, payload.passphrase, payload.iterations)
}

const handleDecryptSecret = async (payload: DecryptPayload): Promise<string> => {
  return decryptSecret(payload.blob, payload.passphrase)
}

const handleDeriveKeys = async (payload: DeriveKeysPayload): Promise<{
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
  const { generateAddressFromPublicKey } = await import('key/genAddrFromPubKey')
  const address = generateAddressFromPublicKey(derived.publicKey.slice(2))
  return {
    privateKey: derived.privateKey,
    publicKey: derived.publicKey,
    address,
    mnemonic: normalized,
  }
}

const handleSignTransaction = async (payload: SignTxPayload): Promise<TxInterface> => {
  return signTransaction(payload.unsignedTx, payload.privateKey)
}

const handleCreateUnsignedTx = async (payload: CreateUnsignedTxPayload): Promise<TxInterface> => {
  const unsigned = createUnsignedTransaction(payload.comTx, payload.nonce)
  if (!unsigned.status || !unsigned.tx) {
    throw new Error(unsigned.error ?? 'Gagal menyusun transaksi')
  }
  return unsigned.tx
}

// ---- Message Router ----

const handlers: Record<WorkerRequestType, (payload: any) => Promise<any>> = {
  ENCRYPT_SECRET: handleEncryptSecret,
  DECRYPT_SECRET: handleDecryptSecret,
  DERIVE_KEYS: handleDeriveKeys,
  SIGN_TRANSACTION: handleSignTransaction,
  CREATE_UNSIGNED_TX: handleCreateUnsignedTx,
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
    const result = await handlers[type](payload)
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