import { uint8ToHex } from 'src/wallet/backup/lib/bytesToHex'
import { hexToBytes } from 'src/core/encoding/sha256'
import { createJsCrypto } from './jsCrypto'

/**
 * Enkripsi rahasia vault memakai **Web Crypto** (Phase C).
 *
 * Skema:
 *   passphrase --PBKDF2-SHA256(salt acak, N iterasi)--> kunci AES-GCM 256
 *   rahasia    --AES-GCM(iv acak 12 byte)------------> ciphertext + tag
 *
 * Kenapa skema ini:
 *   - Web Crypto adalah satu-satunya API kripto bawaan browser yang tersedia
 *     tanpa dependensi. `crypto.subtle` hanya hidup di KONTEKS AMAN
 *     (https:// atau localhost); di origin http+IP biasa browser MENYEMBUNYIKAN
 *     `crypto.subtle`, jadi modul ini otomatis JATUH ke fallback murni JS
 *     (`jsCrypto.ts`) dengan parameter & format identik — vault tetap bisa
 *     dibuka, dan blob hasil http maupun https saling terbuka.
 *   - PBKDF2 membuat brute-force passphrase mahal (salt acak per catatan,
 *     sehingga dua vault dengan passphrase sama tetap berbeda ciphertext).
 *   - AES-GCM bersifat AUTENTIKASI: passphrase salah ATAU ciphertext yang
 *     diutak-atik keduanya ditolak — tidak ada "hasil dekripsi cacat diam-diam".
 *
 * Catatan batasan: secp256k1 TIDAK didukung Web Crypto, jadi penanda-tanganan
 * transaksi tetap memakai `elliptic` (lihat `key/ecc.ts`). Web Crypto di sini
 * hanya untuk MELINDUNGI data di rest, bukan untuk menandatangani transaksi.
 */

/** Format catatan vault; naikkan bila skema berubah. */
export const VAULT_VERSION = 1

/** Nama KDF yang dipakai — divalidasi saat membuka catatan. */
export const KDF_NAME = 'PBKDF2-SHA256'

/**
 * Iterasi PBKDF2 (rekomendasi OWASP untuk PBKDF2-HMAC-SHA256).
 * Sengaja TIDAK diturunkan: menurunkan iterasi = menurunkan biaya brute-force.
 */
export const KDF_ITERATIONS = 310_000

/** Batas atas iterasi dari catatan tersimpan — menolak record aneh/berbahaya. */
const MAX_KDF_ITERATIONS = 10_000_000

/** 16 byte salt PBKDF2. */
const SALT_BYTES = 16

/** 12 byte IV — ukuran standar AES-GCM (96 bit). */
const IV_BYTES = 12

export interface EncryptedBlob {
	version: number
	kdf: typeof KDF_NAME
	iterations: number
	/** hex 32 digit (16 byte) */
	salt: string
	/** hex 24 digit (12 byte) */
	iv: string
	/** hex — termasuk tag auth GCM */
	ciphertext: string
}

const HEX_RE = /^[0-9a-f]+$/

/** Sudah memberi tahu developer sekali bahwa origin tidak aman. */
let fallbackAnnounced = false

/**
 * Deteksi apakah context aman (HTTPS atau localhost).
 * Web Crypto HANYA boleh dipakai di secure context.
 */
const isSecureContext = (): boolean => {
	// Node/Bun environment
	if (
		typeof window === 'undefined' &&
		typeof globalThis !== 'undefined' &&
		globalThis.process?.versions?.node
	) {
		return true
	}
	// Browser: cek isSecureContext API (standar)
	if (
		typeof window !== 'undefined' &&
		typeof window.isSecureContext === 'boolean'
	) {
		return window.isSecureContext
	}
	// Fallback manual check untuk browser lama
	if (typeof location !== 'undefined') {
		const protocol = location.protocol
		const hostname = location.hostname
		return (
			protocol === 'https:' ||
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '[::1]' ||
			hostname === '::1'
		)
	}
	return false
}

/**
 * Crypto yang dipakai vault.
 *
 * Urutan: Web Crypto HANYA di secure context (HTTPS/localhost),
 * SELAIN ITU fallback murni JS — pengguna di `http://<ip-lan>:5174` tetap
 * bisa create/unlock wallet, bukan lagi error "membutuhkan konteks aman".
 */
const getCrypto = (): Crypto => {
	// Force fallback di insecure context (HTTP + non-localhost)
	if (!isSecureContext()) {
		if (!fallbackAnnounced) {
			fallbackAnnounced = true
			console.warn(
				`[vault] Insecure context detected (${
					typeof location === 'undefined' ? 'unknown' : location.origin
				}) — memakai fallback PBKDF2+AES-GCM murni JS. Skema dan format ciphertext IDENTIK dengan Web Crypto.`,
			)
		}
		return createJsCrypto()
	}

	// Secure context: pakai Web Crypto native
	const webCrypto = (globalThis as { crypto?: Crypto }).crypto
	if (webCrypto?.subtle) return webCrypto

	// Fallback safety net
	if (!fallbackAnnounced) {
		fallbackAnnounced = true
		console.warn(
			`[vault] crypto.subtle tidak tersedia di secure context — memakai fallback JS.`,
		)
	}
	return createJsCrypto()
}

/** PBKDF2 -> kunci AES-GCM 256 (non-extractable, hanya di memori). */
const deriveAesKey = async (
	passphrase: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
	usages: KeyUsage[],
	webCrypto: Crypto,
	/** Progress 0..1 selama PBKDF2 — opsional, TIDAK memengaruhi hasil kriptografis. */
	onProgress?: (fraction: number) => void,
): Promise<CryptoKey> => {
	const subtle = webCrypto.subtle
	const material = await subtle.importKey(
		'raw',
		new TextEncoder().encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey'],
	)

	const deriveWith = (count: number): Promise<CryptoKey> =>
		subtle.deriveKey(
			{ name: 'PBKDF2', salt, iterations: count, hash: 'SHA-256' },
			material,
			{ name: 'AES-GCM', length: 256 },
			false,
			usages,
		)

	// Tanpa peninjau progres: jalur tunggal seperti sebelumnya
	// (skrip pengujian Node memakai jalur ini — tanpa kalibrasi/timer).
	if (!onProgress) return deriveWith(iterations)

	// Progres berbasis waktu. PBKDF2 LINEAR terhadap jumlah iterasi, jadi
	// kalibrasi singkat (maks 5.000 iterasi, <2% biaya total) memberi
	// estimasi durasi, lalu progress = elapsed / estimasi.
	// noble `pbkdf2Async` tidak mengekspos callback progres, dan Web Crypto
	// native tidak bisa dipotong — pendekatan ini berlaku untuk KEDUA jalur.
	const calibration = Math.min(iterations, 5_000)
	const calStart = performance.now()
	await deriveWith(calibration)
	const estimateMs = ((performance.now() - calStart) / calibration) * iterations

	let last = 0
	onProgress(0)
	const startedAt = performance.now()
	const timer = setInterval(() => {
		if (estimateMs <= 0) return
		// Kap 0.99: bar tidak pernah "penuh" sebelum derive benar-benar selesai,
		// dan tidak pernah mundur bila estimasi meleset.
		const fraction = Math.min(
			0.99,
			(performance.now() - startedAt) / estimateMs,
		)
		if (fraction > last) {
			last = fraction
			onProgress(fraction)
		}
	}, 100)

	try {
		return await deriveWith(iterations)
	} finally {
		clearInterval(timer)
		onProgress(1)
	}
}

const requireNonEmpty = (value: string, label: string): void => {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} tidak boleh kosong.`)
	}
}

/** Validasi catatan dari penyimpanan sebelum dipakai (bisa jadi korup/diganti). */
const validateBlob = (blob: EncryptedBlob): void => {
	if (!blob || blob.kdf !== KDF_NAME) {
		throw new Error(`Format vault tidak didukung (kdf: ${String(blob?.kdf)}).`)
	}
	if (blob.version !== VAULT_VERSION) {
		throw new Error(`Versi vault tidak didukung (${String(blob.version)}).`)
	}
	if (
		!Number.isInteger(blob.iterations) ||
		blob.iterations < 1 ||
		blob.iterations > MAX_KDF_ITERATIONS
	) {
		throw new Error('Parameter KDF pada vault tidak valid.')
	}
	if (
		blob.salt.length !== SALT_BYTES * 2 ||
		!HEX_RE.test(blob.salt) ||
		blob.iv.length !== IV_BYTES * 2 ||
		!HEX_RE.test(blob.iv) ||
		blob.ciphertext.length === 0 ||
		!HEX_RE.test(blob.ciphertext)
	) {
		throw new Error('Data vault tidak berformat hex yang valid.')
	}
}

/**
 * Enkripsi rahasia (mnemonic) dengan passphrase.
 *
 * `iterations` boleh dioverride HANYA untuk pengujian cepat; produksi memakai
 * `KDF_ITERATIONS`.
 */
export const encryptSecret = async (
	secret: string,
	passphrase: string,
	iterations: number = KDF_ITERATIONS,
	/** Untuk pengujian: paksa jalur Web Crypto ATAU fallback murni JS. */
	webCrypto: Crypto = getCrypto(),
	/** Progress 0..1 selama PBKDF2 (untuk UI). */
	onProgress?: (fraction: number) => void,
): Promise<EncryptedBlob> => {
	requireNonEmpty(secret, 'Rahasia yang dienkripsi')
	requireNonEmpty(passphrase, 'Passphrase vault')
	if (!Number.isInteger(iterations) || iterations < 1) {
		throw new Error('Iterasi KDF tidak valid.')
	}

	const salt = webCrypto.getRandomValues(new Uint8Array(SALT_BYTES))
	const iv = webCrypto.getRandomValues(new Uint8Array(IV_BYTES))

	const key = await deriveAesKey(
		passphrase,
		salt,
		iterations,
		['encrypt'],
		webCrypto,
		onProgress,
	)
	const ciphertext = await webCrypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(secret),
	)

	return {
		version: VAULT_VERSION,
		kdf: KDF_NAME,
		iterations,
		salt: uint8ToHex(salt),
		iv: uint8ToHex(iv),
		ciphertext: uint8ToHex(new Uint8Array(ciphertext)),
	}
}

/**
 * Dekripsi rahasia dengan passphrase.
 *
 * Melempar Error dengan pesan yang sama untuk "passphrase salah" dan "data
 * rusak/diubah" — keduanya tidak bisa dibedakan secara kriptografis pada
 * AES-GCM (keduanya cukup gagal verifikasi tag).
 */
export const decryptSecret = async (
	blob: EncryptedBlob,
	passphrase: string,
	/** Untuk pengujian: paksa jalur Web Crypto ATAU fallback murni JS. */
	webCrypto: Crypto = getCrypto(),
	/** Progress 0..1 selama PBKDF2 (untuk UI). */
	onProgress?: (fraction: number) => void,
): Promise<string> => {
	validateBlob(blob)
	requireNonEmpty(passphrase, 'Passphrase vault')

	const key = await deriveAesKey(
		passphrase,
		hexToBytes(blob.salt),
		blob.iterations,
		['decrypt'],
		webCrypto,
		onProgress,
	)

	let plain: ArrayBuffer
	try {
		plain = await webCrypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: hexToBytes(blob.iv) },
			key,
			hexToBytes(blob.ciphertext),
		)
	} catch {
		throw new Error('Passphrase salah, atau data vault rusak/telah diubah.')
	}

	return new TextDecoder().decode(plain)
}
