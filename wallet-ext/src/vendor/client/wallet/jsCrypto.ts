import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Fallback vault crypto **murni JavaScript** untuk origin yang BUKAN konteks
 * aman (`http://` + IP LAN) — dipakai `vaultCrypto.ts` bila `crypto.subtle`
 * tidak ada.
 *
 * Kenapa perlu: browser MENYEMBUNYIKAN `crypto.subtle` di insecure context,
 * padahal vault butuh PBKDF2 + AES-GCM. Tanpa fallback, wallet hanya bisa
 * dibuka lewat https:// atau localhost.
 *
 * Kenapa @noble/*:
 *   - audited, zero-dependency, murni JS → jalan tanpa Web Crypto sekali pun;
 *   - parameter & FORMAT IDENTIK dengan Web Crypto, jadi ciphertext saling
 *     terbuka: blob dibuat lewat http bisa di-unlock lewat https dan
 *     sebaliknya (diuji di `scripts/walletVaultCheck.ts`).
 *
 * Skema yang direplikasi persis:
 *   passphrase --PBKDF2-HMAC-SHA256(salt, iterations, 32 byte)--> AES-256-GCM
 *   rahasia    --AES-GCM(iv 12 byte)----------------------------> ciphertext || tag 16 byte
 *
 * Catatan risiko: algoritmanya sama kuat dengan jalur Web Crypto; yang
 * melemahkan http adalah HALAMAN yang bisa dimodifikasi pihak lain di jalan
 * (MITM) sebelum sampai ke browser. Fallback ini untuk pengujian/LAN, bukan
 * penggunaan publik.
 */

/**
 * Padanan `CryptoKey` non-extractable: bahan kunci hanya hidup di memori
 * proses ini dan tidak pernah bisa dikeluarkan lewat API apa pun.
 */
interface JsCryptoKey {
	readonly bytes: Uint8Array
	readonly usages: KeyUsage[]
	/** Peran kunci — mencegah bahan PBKDF2 dipakai langsung sebagai key AES. */
	readonly role: 'pbkdf2-password' | 'aes'
}

const unsupported = (what: string): never => {
	throw new Error(`Fallback vault: ${what} tidak didukung.`)
}

/**
 * Nama algoritma dari `AlgorithmIdentifier` — Web Crypto menerima string
 * (`'PBKDF2'`) maupun object (`{ name: 'AES-GCM', iv }`).
 */
const algorithmName = (algorithm: AlgorithmIdentifier): string =>
	typeof algorithm === 'string' ? algorithm : algorithm.name

/** BufferSource (ArrayBuffer ATAU view) -> Uint8Array tanpa menyalin. */
const toBytes = (data: BufferSource): Uint8Array =>
	data instanceof ArrayBuffer
		? new Uint8Array(data)
		: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

/** Salin bytes ke ArrayBuffer milik sendiri (wajib: Web Crypto mengembalikan ArrayBuffer). */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer

const requireRole = (key: JsCryptoKey, role: JsCryptoKey['role']): void => {
	if (key.role !== role) {
		unsupported(`penggunaan kunci '${key.role}' sebagai '${role}'`)
	}
}

const requireUsage = (key: JsCryptoKey, usage: KeyUsage): void => {
	if (!key.usages.includes(usage)) {
		unsupported(`kunci tanpa usage '${usage}'`)
	}
}

/**
 * Buat objek `Crypto` tiruan yang hanya memuat jalur yang dipakai vault:
 * `getRandomValues`, `subtle.importKey/deriveKey/encrypt/decrypt`.
 *
 * `getRandomValues` menerus ke implementasi bawaan browser bila ada (dia
 * TETAP tersedia di insecure context); hanya `subtle` yang benar-benar
 * diganti implementasinya.
 */
export const createJsCrypto = (): Crypto => {
	const native = (globalThis as { crypto?: Crypto }).crypto

	const subtle = {
		importKey: (
			format: string,
			keyData: BufferSource,
			/** Web Crypto mengizinkan nama sebagai STRING ('PBKDF2') ATAU object. */
			algorithm: AlgorithmIdentifier,
			_extractable: boolean,
			keyUsages: KeyUsage[],
		): Promise<JsCryptoKey> => {
			if (format !== 'raw') unsupported(`format importKey '${format}'`)
			const name = algorithmName(algorithm)
			if (name !== 'PBKDF2') unsupported(`importKey algoritma '${name}'`)
			return Promise.resolve({
				bytes: toBytes(keyData).slice(),
				usages: keyUsages,
				role: 'pbkdf2-password',
			})
		},

		deriveKey: async (
			algorithm: {
				name: string
				salt: BufferSource
				iterations: number
				hash: string | { name: string }
			},
			baseKey: JsCryptoKey,
			derivedKeyType: { name: string; length?: number },
			_extractable: boolean,
			keyUsages: KeyUsage[],
		): Promise<JsCryptoKey> => {
			if (algorithm.name !== 'PBKDF2') {
				unsupported(`deriveKey algoritma '${algorithm.name}'`)
			}
			requireRole(baseKey, 'pbkdf2-password')
			if (derivedKeyType.name !== 'AES-GCM') {
				unsupported(`turunan kunci '${derivedKeyType.name}'`)
			}
			const hashName =
				typeof algorithm.hash === 'string'
					? algorithm.hash
					: algorithm.hash.name
			if (hashName.toUpperCase() !== 'SHA-256') {
				unsupported(`hash KDF '${hashName}'`)
			}
			const bits = derivedKeyType.length ?? 256
			if (bits % 8 !== 0) unsupported(`panjang kunci ${bits} bit`)

			// pbkdf2Async (bukan pbkdf2) supaya 310.000 iterasi tidak membekukan
			// main thread selamanya — tiap asyncTick ms komputasi event loop
			// dipotong sebentar supaya animasi/UI sempat jalan.
			//
			// Nilai 250 (bukan 20) hasil benchmark round-robin `vaultBench.ts`
			// pada 310.000 iterasi, minimum 4 run, sebaran <10%:
			//     native 131ms | sync 854ms | tick=250 919ms | tick=100 1009ms
			//     tick=20 1431ms  ← nilai lama, +68% murni sia-sia untuk yield
			// tick=250 hanya +8% dari sync, sementara main thread tetap dipotong
			// maksimal ~250ms sekali jalan. Spinner memakai `transform: rotate`
			// yang berjalan di kompositor, jadi tetap mulus walau main thread
			// sedang sibuk menghitung.
			const bytes = await pbkdf2Async(
				sha256,
				baseKey.bytes,
				toBytes(algorithm.salt),
				{ c: algorithm.iterations, dkLen: bits / 8, asyncTick: 250 },
			)
			return { bytes, usages: keyUsages, role: 'aes' }
		},

		encrypt: (
			algorithm: { name: string; iv: BufferSource },
			key: JsCryptoKey,
			data: BufferSource,
		): Promise<ArrayBuffer> => {
			if (algorithm.name !== 'AES-GCM') {
				unsupported(`encrypt algoritma '${algorithm.name}'`)
			}
			requireRole(key, 'aes')
			requireUsage(key, 'encrypt')
			// @noble/ciphers mengembalikan ciphertext || tag 16 byte — sama
			// persis dengan yang dikembalikan crypto.subtle.encrypt.
			const sealed = gcm(key.bytes, toBytes(algorithm.iv)).encrypt(
				toBytes(data),
			)
			return Promise.resolve(toArrayBuffer(sealed))
		},

		decrypt: (
			algorithm: { name: string; iv: BufferSource },
			key: JsCryptoKey,
			data: BufferSource,
		): Promise<ArrayBuffer> => {
			if (algorithm.name !== 'AES-GCM') {
				unsupported(`decrypt algoritma '${algorithm.name}'`)
			}
			requireRole(key, 'aes')
			requireUsage(key, 'decrypt')
			try {
				const opened = gcm(key.bytes, toBytes(algorithm.iv)).decrypt(
					toBytes(data),
				)
				return Promise.resolve(toArrayBuffer(opened))
			} catch (error) {
				// Tag GCM tidak cocok: passphrase salah ATAU ciphertext diubah.
				// Dilempar balik sebagai rejection supaya pemanggil menyamaratakan
				// jadi satu pesan "passphrase salah" (lihat decryptSecret).
				return Promise.reject(error)
			}
		},
	}

	const shim = {
		getRandomValues: <T extends ArrayBufferView<ArrayBuffer> | null>(
			array: T,
		): T => {
			if (array === null) return array
			if (native?.getRandomValues) return native.getRandomValues(array)
			const bytes = randomBytes(array.byteLength)
			new Uint8Array(array.buffer, array.byteOffset, bytes.length).set(bytes)
			return array
		},
		subtle,
	}

	// Cast eksplisit: shim MEMANGGIL hanya 5 metode di atas; anggota Crypto
	// lainnya (deriveBits, sign, ...) tidak pernah dipakai vault.
	return shim as unknown as Crypto
}
