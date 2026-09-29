import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { validateMnemonic } from 'src/crypto/validateMnemonic'
import { generateKeysFromMnemonic } from 'src/crypto/generateKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'src/crypto/generateAddressFromPublicKey'
import type { WalletKV } from './kv'
import { decryptSecret, encryptSecret, type EncryptedBlob } from './vaultCrypto'

/**
 * Vault wallet browser — **satu akun, satu passphrase** (Phase C).
 *
 * Pembanding: `structWalletToSave` (Node/CLI) menyimpan `{ address, phrase }`
 * mentah di `wallet/main.json`. Di browser tidak ada filesystem yang bisa
 * diamankan, jadi di sini `phrase` di-encrypt dulu dengan Web Crypto sebelum
 * disimpan di IndexedDB.
 *
 * APA YANG DISIMPAN PLAINTEXT (publik, aman ditampilkan tanpa unlock):
 *   address, publicKey, createdAt
 *
 * APA YANG DIENKRIPSI (rahasia):
 *   mnemonic — SATU-satunya rahasia di rest. Private key TIDAK pernah
 *   disimpan: ia diturunkan ulang dari mnemonic saat `unlock` dan hanya hidup
 *   di memori.
 *
 * Model keamanan:
 *   - Private key & mnemonic tidak pernah ditulis balik ke penyimpanan.
 *   - `unlock` memverifikasi hasil turunan cocok dengan `address` tercatat,
 *     sehingga record yang korup/diganti menolak dibuka, bukan membuka wallet
 *     yang salah.
 *   - Tidak ada yang dikirim ke jaringan; semuanya lokal.
 */

/** Kunci record wallet di dalam `WalletKV`. */
export const PRIMARY_WALLET_ID = 'primary'

/** Info wallet yang boleh terbaca TANPA passphrase. */
export interface WalletInfo {
	address: string
	publicKey: string
	createdAt: number
}

/** Catatan utuh yang disimpan di penyimpanan. `blob` sudah ter-encrypt. */
export interface VaultRecord {
	id: string
	address: string
	publicKey: string
	createdAt: number
	blob: EncryptedBlob
}

/** Hasil unlock — hanya hidup di memori, tidak pernah dipersist. */
export interface UnlockedWallet {
	address: string
	publicKey: string
	privateKey: string
	mnemonic: string
}

export interface WalletVault {
	hasWallet(): Promise<boolean>
	getInfo(): Promise<WalletInfo | undefined>
	isUnlocked(): boolean
	/** Buat wallet baru (mnemonic acak) — vault langsung terbuka. */
	create(passphrase: string): Promise<WalletInfo>
	/** Simpan mnemonic yang sudah dimiliki user — vault langsung terbuka. */
	importMnemonic(mnemonic: string, passphrase: string): Promise<WalletInfo>
	unlock(passphrase: string): Promise<WalletInfo>
	lock(): void
	getUnlocked(): UnlockedWallet
	/** Hapus record + tutup kunci. Tidak bisa dibatalkan. */
	wipe(): Promise<void>
}

/**
 * Buat vault di atas backend penyimpanan apa pun.
 *
 * @param kv    IndexedDB di browser (`createIdbKV`), memori di pengujian
 *              (`createMemoryKV`).
 * @param walletId  Record yang dipakai; default `'primary'`.
 */
export const createWalletVault = (
	kv: WalletKV,
	walletId: string = PRIMARY_WALLET_ID,
): WalletVault => {
	/** Rahasia terbuka — hanya di memori proses ini. */
	let unlocked: UnlockedWallet | undefined

	const readRecord = async (): Promise<VaultRecord | undefined> =>
		await kv.get<VaultRecord>(walletId)

	const toInfo = (record: VaultRecord): WalletInfo => ({
		address: record.address,
		publicKey: record.publicKey,
		createdAt: record.createdAt,
	})

	/** Mnemonic -> kunci + alamat, memakai jalur turunan yang SUDAH teruji. */
	const deriveFromMnemonic = (mnemonic: string): UnlockedWallet => {
		// Normalisasi spasi: handle copy-paste dengan spasi ganda/newline
		// Idempotent: aman dipakai berulang, tidak mengubah mnemonic yang sudah bersih
		const normalized = mnemonic.trim().replace(/\s+/g, ' ')
		const { privateKey, publicKey } = generateKeysFromMnemonic(normalized)
		return {
			// generateAddressFromPublicKey menerima hex TANPA prefix Nx
			address: generateAddressFromPublicKey(publicKey.slice(2)),
			publicKey,
			privateKey,
			mnemonic: normalized,
		}
	}

	const assertEmpty = async (): Promise<void> => {
		if (await readRecord()) {
			throw new Error(
				'Vault sudah berisi wallet. Panggil wipe() dulu sebelum menyimpan yang baru.',
			)
		}
	}

	const persist = async (
		mnemonic: string,
		passphrase: string,
	): Promise<WalletInfo> => {
		const derived = deriveFromMnemonic(mnemonic)
		const blob = await encryptSecret(mnemonic, passphrase)
		const record: VaultRecord = {
			id: walletId,
			address: derived.address,
			publicKey: derived.publicKey,
			createdAt: Date.now(),
			blob,
		}
		await kv.set(walletId, record)

		// Pemanggil baru saja mengetik passphrase-nya sendiri, jadi tidak perlu
		// memaksanya mengetik ulang untuk membuka vault yang baru dibuat.
		unlocked = derived
		return toInfo(record)
	}

	return {
		hasWallet: async (): Promise<boolean> => (await readRecord()) !== undefined,

		getInfo: async (): Promise<WalletInfo | undefined> => {
			const record = await readRecord()
			return record ? toInfo(record) : undefined
		},

		isUnlocked: (): boolean => unlocked !== undefined,

		create: async (passphrase: string): Promise<WalletInfo> => {
			await assertEmpty()
			return persist(genRandomMnemonic(), passphrase)
		},

		importMnemonic: async (
			mnemonic: string,
			passphrase: string,
		): Promise<WalletInfo> => {
			// Normalisasi spasi dulu: salinan/tempel sering membawa spasi ganda
			// atau newline, yang membuat checksum BIP39 gagal padahal benar.
			const normalized = mnemonic.trim().replace(/\s+/g, ' ')
			validateMnemonic(normalized)
			await assertEmpty()
			return persist(normalized, passphrase)
		},

		unlock: async (passphrase: string): Promise<WalletInfo> => {
			const record = await readRecord()
			if (!record) {
				throw new Error('Vault kosong — buat atau impor wallet dulu.')
			}

			const mnemonic = await decryptSecret(record.blob, passphrase)
			// `generateKeysFromMnemonic` melempar bila mnemonic korup, sehingga
			// `unlocked` tidak pernah terisi oleh isi yang rusak.
			const derived = deriveFromMnemonic(mnemonic)

			if (derived.address !== record.address) {
				throw new Error(
					'Isi vault tidak cocok dengan alamat tercatat; wallet tidak dibuka.',
				)
			}

			unlocked = derived
			return toInfo(record)
		},

		lock: (): void => {
			unlocked = undefined
		},

		getUnlocked: (): UnlockedWallet => {
			if (!unlocked) {
				throw new Error('Vault terkunci — panggil unlock(passphrase) dulu.')
			}
			return unlocked
		},

		wipe: async (): Promise<void> => {
			unlocked = undefined
			await kv.delete(walletId)
		},
	}
}
