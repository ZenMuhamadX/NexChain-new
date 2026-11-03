import { createWalletVault } from 'src/client/wallet/walletVault'
import type { WalletVault } from 'src/client/wallet/walletVault'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { validateMnemonic } from 'src/crypto/validateMnemonic'
import { cryptoWorker } from '@/hooks/useCryptoWorker'
import { getPbkdf2Iterations } from '@/lib/deviceCrypto'
import { getVaultKV } from '@/lib/vaultStore'

/**
 * TITIK SUNTIK 2 — kripto vault.
 *
 * Vault-nya sendiri milik `src/client/wallet/walletVault.ts` (jalur yang diuji
 * `bun run check:wallet`); yang berbeda di browser hanya DI MANA kripto
 * berjalan. Di sini PBKDF2 (100k/310k iterasi) + BIP39/BIP32 dijalankan di Web
 * Worker supaya layar tidak membeku selama beberapa detik.
 *
 * Dulu berkas ini memelihara salinan penuh create/import/unlock/lock/wipe.
 * Salinan itu tidak tercakup gate mana pun, jadi satu-satunya jalur yang
 * dikirim ke pengguna justru yang tidak pernah diuji. Sekarang cukup suntikan.
 */
let vaultPromise: Promise<WalletVault> | undefined

const createWorkerVault = async (): Promise<WalletVault> => {
	// Backend dipilih `vaultStore` (inject dari shell → env → IndexedDB).
	const kv = await getVaultKV()
	return createWalletVault(kv, {
		crypto: {
			genMnemonic: genRandomMnemonic,
			validateMnemonic,
			deriveKeys: (mnemonic) => cryptoWorker.deriveKeys(mnemonic),
			encryptSecret: (secret, passphrase) =>
				cryptoWorker.encryptSecret(secret, passphrase, getPbkdf2Iterations()),
			decryptSecret: (blob, passphrase) =>
				cryptoWorker.decryptSecret(blob, passphrase),
		},
	})
}

export const getVault = (): Promise<WalletVault> => {
	if (!vaultPromise) {
		vaultPromise = createWorkerVault()
	}
	return vaultPromise
}
