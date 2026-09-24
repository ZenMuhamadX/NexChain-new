import { createIdbKV } from 'client/wallet/idbKv'
import { createWalletVault } from 'client/wallet/walletVault'
import type { WalletVault } from 'client/wallet/walletVault'
import type { VaultRecord, UnlockedWallet, WalletInfo } from 'client/wallet/walletVault'
import { cryptoWorker } from '@/hooks/useCryptoWorker'
import { getPbkdf2Iterations } from '@/lib/deviceCrypto'

/**
 * Browser-specific vault wrapper that offloads crypto to Web Worker.
 *
 * Wraps the shared `WalletVault` and intercepts crypto-heavy operations:
 *   - create/importMnemonic → encryptSecret (PBKDF2) + deriveKeys (BIP39/BIP32)
 *   - unlock → decryptSecret (PBKDF2) + deriveKeys
 *
 * State `unlocked` dimiliki wrapper ini sendiri. `baseVault.unlock` TIDAK
 * dipanggil: worker sudah melakukan decrypt + derive sekali jalan, mengulang
 * PBKDF2 (100k/310k iterasi) di main thread hanya untuk set state membuang
 * ~50% waktu unlock.
 *
 * This keeps the shared `client/wallet/walletVault.ts` unchanged for Node/CLI use.
 */

let vaultPromise: Promise<WalletVault> | undefined

// Wrap the original vault to use worker for crypto
const createWorkerVault = async (): Promise<WalletVault> => {
  const kv = await createIdbKV()
  const baseVault = createWalletVault(kv)

  /**
   * State terbuka — hanya di memori proses ini (mirip `unlocked` di
   * `createWalletVault`, tapi milik wrapper karena unlock di sini tidak
   * melewati `baseVault.unlock`).
   */
  let unlocked: UnlockedWallet | undefined

  const toInfo = (record: VaultRecord): WalletInfo => ({
    address: record.address,
    publicKey: record.publicKey,
    createdAt: record.createdAt,
  })

  const assertEmpty = async (): Promise<void> => {
    if (await kv.get('primary')) {
      throw new Error(
        'Vault sudah berisi wallet. Panggil wipe() dulu sebelum menyimpan yang baru.',
      )
    }
  }

  // Decrypt + derive di worker, verifikasi alamat, lalu set state terbuka.
  const workerUnlock = async (passphrase: string): Promise<WalletInfo> => {
    const record = (await kv.get('primary')) as VaultRecord | undefined
    if (!record) {
      throw new Error('Vault kosong — buat atau impor wallet dulu.')
    }

    const mnemonic = await cryptoWorker.decryptSecret(record.blob, passphrase)
    const derived = await cryptoWorker.deriveKeys(mnemonic)

    if (derived.address !== record.address) {
      throw new Error('Isi vault tidak cocok dengan alamat tercatat; wallet tidak dibuka.')
    }

    unlocked = {
      address: derived.address,
      publicKey: derived.publicKey,
      privateKey: derived.privateKey,
      mnemonic: derived.mnemonic,
    }
    return toInfo(record)
  }

  return {
    ...baseVault,

    isUnlocked: (): boolean => unlocked !== undefined,

    getUnlocked: (): UnlockedWallet => {
      if (!unlocked) {
        throw new Error('Vault terkunci — panggil unlock(passphrase) dulu.')
      }
      return unlocked
    },

    lock: (): void => {
      unlocked = undefined
    },

    wipe: async (): Promise<void> => {
      unlocked = undefined
      await baseVault.wipe()
    },

    create: async (passphrase: string): Promise<WalletInfo> => {
      await assertEmpty()

      // Generate mnemonic + derive keys in worker
      const { genRandomMnemonic } = await import('key/genRandomMnemonic')
      const mnemonic = genRandomMnemonic()
      const derived = await cryptoWorker.deriveKeys(mnemonic)

      // Encrypt mnemonic in worker with device-appropriate iterations
      const iterations = getPbkdf2Iterations()
      const blob = await cryptoWorker.encryptSecret(mnemonic, passphrase, iterations)

      const record: VaultRecord = {
        id: 'primary',
        address: derived.address,
        publicKey: derived.publicKey,
        createdAt: Date.now(),
        blob,
      }
      await kv.set('primary', record)

      // Pemanggil baru saja mengetik passphrase-nya sendiri, jadi vault
      // langsung terbuka tanpa decrypt ulang.
      unlocked = {
        address: derived.address,
        publicKey: derived.publicKey,
        privateKey: derived.privateKey,
        mnemonic: derived.mnemonic,
      }
      return toInfo(record)
    },

    importMnemonic: async (mnemonic: string, passphrase: string): Promise<WalletInfo> => {
      // Validate & normalize (same as original)
      const { validateMnemonic } = await import('key/validateMnemonic')
      const normalized = mnemonic.trim().replace(/\s+/g, ' ')
      validateMnemonic(normalized)

      await assertEmpty()

      // Derive keys in worker
      const derived = await cryptoWorker.deriveKeys(normalized)

      // Encrypt mnemonic in worker with device-appropriate iterations
      const iterations = getPbkdf2Iterations()
      const blob = await cryptoWorker.encryptSecret(normalized, passphrase, iterations)

      const record: VaultRecord = {
        id: 'primary',
        address: derived.address,
        publicKey: derived.publicKey,
        createdAt: Date.now(),
        blob,
      }
      await kv.set('primary', record)

      // Vault langsung terbuka (passphrase baru saja diketik pemanggil).
      unlocked = {
        address: derived.address,
        publicKey: derived.publicKey,
        privateKey: derived.privateKey,
        mnemonic: derived.mnemonic,
      }
      return toInfo(record)
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
