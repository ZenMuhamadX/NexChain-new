import { createIdbKV } from 'client/wallet/idbKv'
import { createWalletVault } from 'client/wallet/walletVault'
import type { WalletVault } from 'client/wallet/walletVault'
import type { VaultRecord } from 'client/wallet/walletVault'
import { cryptoWorker } from '@/hooks/useCryptoWorker'
import { getPbkdf2Iterations } from '@/lib/deviceCrypto'

/**
 * Browser-specific vault wrapper that offloads crypto to Web Worker.
 *
 * Wraps the shared `WalletVault` and intercepts crypto-heavy operations:
 *   - create/importMnemonic → encryptSecret (PBKDF2) + deriveKeys (BIP39/BIP32)
 *   - unlock → decryptSecret (PBKDF2) + deriveKeys
 *
 * This keeps the shared `client/wallet/walletVault.ts` unchanged for Node/CLI use.
 */

let vaultPromise: Promise<WalletVault> | undefined

// Wrap the original vault to use worker for crypto
const createWorkerVault = async (): Promise<WalletVault> => {
  const kv = await createIdbKV()
  const baseVault = createWalletVault(kv)

  // Keep reference to original unlock for internal use
  const originalUnlock = baseVault.unlock.bind(baseVault)

  // Custom unlock using worker (defined first so create/import can use it)
  const workerUnlock = async (passphrase: string) => {
    const record = (await kv.get('primary')) as VaultRecord | undefined
    if (!record) {
      throw new Error('Vault kosong — buat atau impor wallet dulu.')
    }

    // Decrypt mnemonic in worker
    const mnemonic = await cryptoWorker.decryptSecret(record.blob, passphrase)

    // Derive keys in worker
    const derived = await cryptoWorker.deriveKeys(mnemonic)

    // Verify address matches
    if (derived.address !== record.address) {
      throw new Error('Isi vault tidak cocok dengan alamat tercatat; wallet tidak dibuka.')
    }

    // Call original unlock to set internal unlocked state (it will re-verify)
    // This is necessary because we can't access the private `unlocked` variable
    return originalUnlock(passphrase)
  }

  return {
    ...baseVault,

    create: async (passphrase: string) => {
      // Generate mnemonic + derive keys in worker
      const { genRandomMnemonic } = await import('key/genRandomMnemonic')
      const mnemonic = genRandomMnemonic()
      const derived = await cryptoWorker.deriveKeys(mnemonic)

      // Encrypt mnemonic in worker with device-appropriate iterations
      const iterations = getPbkdf2Iterations()
      const blob = await cryptoWorker.encryptSecret(mnemonic, passphrase, iterations)

      // Persist manually (replicate persist logic from walletVault)
      const record = {
        id: 'primary',
        address: derived.address,
        publicKey: derived.publicKey,
        createdAt: Date.now(),
        blob,
      }
      await kv.set('primary', record)

      // Set unlocked state by calling our worker unlock
      // This ensures internal `unlocked` is set without re-doing encrypt
      await workerUnlock(passphrase)

      return { address: derived.address, publicKey: derived.publicKey, createdAt: record.createdAt }
    },

    importMnemonic: async (mnemonic: string, passphrase: string) => {
      // Validate & normalize (same as original)
      const { validateMnemonic } = await import('key/validateMnemonic')
      const normalized = mnemonic.trim().replace(/\s+/g, ' ')
      validateMnemonic(normalized)

      // Check empty
      if (await kv.get('primary')) {
        throw new Error('Vault sudah berisi wallet. Panggil wipe() dulu sebelum menyimpan yang baru.')
      }

      // Derive keys in worker
      const derived = await cryptoWorker.deriveKeys(normalized)

      // Encrypt mnemonic in worker with device-appropriate iterations
      const iterations = getPbkdf2Iterations()
      const blob = await cryptoWorker.encryptSecret(normalized, passphrase, iterations)

      // Persist
      const record = {
        id: 'primary',
        address: derived.address,
        publicKey: derived.publicKey,
        createdAt: Date.now(),
        blob,
      }
      await kv.set('primary', record)

      // Set unlocked state
      await workerUnlock(passphrase)

      return { address: derived.address, publicKey: derived.publicKey, createdAt: record.createdAt }
    },

    unlock: workerUnlock,
  }
}

export const getVault = (): Promise<WalletVault> => {
  if (!vaultPromise) {
    vaultPromise = createWorkerVault()
  }
  return vaultPromise
}