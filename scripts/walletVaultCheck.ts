/**
 * Gerbang regresi Phase C — vault wallet browser (IndexedDB + Web Crypto).
 *
 * Logika vault diuji di atas `createMemoryKV()` (cepat, deterministik), DAN
 * bagian terakhir MENGEKSEKUSI `createIdbKV` sungguhan di atas
 * `fake-indexeddb` — jadi adapter IndexedDB-nya tidak hanya "terbukti bisa
 * dibundle" (`bun run check:browser`) tetapi benar-benar berjalan.
 *
 * Jalankan:  bun run check:wallet
 *
 * Yang dipastikan:
 *   - Web Crypto roundtrip + salt/iv acak + ciphertext tak bocor plaintext
 *   - passphrase salah / ciphertext diutak-atik ditolak (AES-GCM auth)
 *   - fallback murni JS (origin http tanpa `crypto.subtle`) roundtrip + auth
 *   - INTEROP dua arah: blob http <-> blob https saling terbuka
 *   - `crypto.subtle` hilang -> getCrypto() memilih fallback, bukan error
 *   - vault: create/import/unlock/lock/wipe, persistensi antar-instance
 *   - record tersimpan TIDAK memuat mnemonic maupun private key (plaintext)
 *   - alamat hasil jalur vault identik dengan jalur turunan langsung
 *   - backend IndexedDB: put/get/delete + structured-clone record utuh
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { createMemoryKV, type WalletKV } from 'client/wallet/kv'
import { createIdbKV } from 'client/wallet/idbKv'
import {
	decryptSecret,
	encryptSecret,
	KDF_ITERATIONS,
	KDF_NAME,
} from 'client/wallet/vaultCrypto'
import { createJsCrypto } from 'client/wallet/jsCrypto'
import { createWalletVault, type VaultRecord } from 'client/wallet/walletVault'
import { genRandomMnemonic } from 'key/genRandomMnemonic'
import { generateKeysFromMnemonic } from 'key/genKeyFromMnemonic'
import { generateAddressFromPublicKey } from 'key/genAddrFromPubKey'

/** Alamat `wallet/main.json` yang sudah terdokumentasi (lihat check:tx). */
const KNOWN_MAIN_ADDRESS = 'NxC41296362ed2b66dd3bd0a4c96b440ecf36973189'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
	if (cond) {
		pass++
		console.log(`  OK   ${name}`)
	} else {
		fail++
		console.log(`  FAIL ${name}${extra ? '  -> ' + extra : ''}`)
	}
}

const toError = (fn: () => unknown): string => {
	try {
		fn()
		return ''
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

const toErrorAsync = async (fn: () => Promise<unknown>): Promise<string> => {
	try {
		await fn()
		return ''
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

/** Iterasi rendah HANYA untuk menguji kriptografinya; vault memakai default. */
const FAST = 1_000
const PASSPHRASE = 'rahasia-uji-phase-c'
const IMPORT_PASS = 'passphrase-import'
const WRONG = 'salah'
const SECRET = genRandomMnemonic()

// ============ 1. vaultCrypto (Web Crypto) ============
console.log('\n--- vaultCrypto: Web Crypto PBKDF2 + AES-GCM ---')

const blob = await encryptSecret(SECRET, PASSPHRASE, FAST)
const decrypted = await decryptSecret(blob, PASSPHRASE)

ok('roundtrip: enkripsi -> dekripsi mengembalikan rahasia persis', decrypted === SECRET)
ok('salt 32 hex (16 byte)', blob.salt.length === 32 && /^[0-9a-f]+$/.test(blob.salt))
ok('iv 24 hex (12 byte)', blob.iv.length === 24 && /^[0-9a-f]+$/.test(blob.iv))
ok('ciphertext hex, bukan plaintext', /^[0-9a-f]+$/.test(blob.ciphertext) && !blob.ciphertext.includes(SECRET))
ok('kdf & versi tercatat benar', blob.kdf === KDF_NAME && blob.version === 1)

const blob2 = await encryptSecret(SECRET, PASSPHRASE, FAST)
ok(
	'salt+iv acak: rahasia sama -> ciphertext berbeda',
	blob2.ciphertext !== blob.ciphertext && blob2.salt !== blob.salt && blob2.iv !== blob.iv,
)

ok(
	'passphrase salah DITOLAK (AES-GCM auth)',
	(await toErrorAsync(() => decryptSecret(blob, WRONG))).includes('Passphrase salah'),
)
const flipped = (blob.ciphertext[0] === '0' ? '1' : '0') + blob.ciphertext.slice(1)
ok(
	'ciphertext diutak-atik DITOLAK (tag GCM)',
	(await toErrorAsync(() => decryptSecret({ ...blob, ciphertext: flipped }, PASSPHRASE))).includes('Passphrase salah'),
)
ok(
	'kdf asing DITOLAK',
	(await toErrorAsync(() =>
		decryptSecret({ ...blob, kdf: 'scrypt' as unknown as typeof KDF_NAME }, PASSPHRASE),
	)).includes('tidak didukung'),
)
ok(
	'salt salah panjang DITOLAK',
	(await toErrorAsync(() => decryptSecret({ ...blob, salt: 'ab' }, PASSPHRASE))).includes('hex'),
)
ok(
	'passphrase kosong DITOLAK saat enkripsi',
	(await toErrorAsync(() => encryptSecret(SECRET, '', FAST))).includes('tidak boleh kosong'),
)

const defaultBlob = await encryptSecret(SECRET, PASSPHRASE)
ok(
	`produksi memakai KDF_ITERATIONS=${KDF_ITERATIONS}`,
	defaultBlob.iterations === KDF_ITERATIONS &&
		(await decryptSecret(defaultBlob, PASSPHRASE)) === SECRET,
)

// ============ 1b. fallback murni JS (origin http) ============
console.log('\n--- vaultCrypto: fallback murni JS (tanpa crypto.subtle) ---')

// Jalur inilah yang dipakai browser saat dibuka lewat http://<ip-lan>:5174.
const jsCrypto = createJsCrypto()
const nativeCrypto = globalThis.crypto

const jsBlob = await encryptSecret(SECRET, PASSPHRASE, FAST, jsCrypto)
ok(
	'js: roundtrip enkripsi -> dekripsi persis',
	(await decryptSecret(jsBlob, PASSPHRASE, jsCrypto)) === SECRET,
)
ok(
	'js: format salt/iv/ciphertext IDENTIK jalur Web Crypto',
	jsBlob.salt.length === 32 &&
		jsBlob.iv.length === 24 &&
		/^[0-9a-f]+$/.test(jsBlob.ciphertext),
)
ok(
	'js: passphrase salah DITOLAK (tag GCM)',
	(await toErrorAsync(() => decryptSecret(jsBlob, WRONG, jsCrypto))).includes('Passphrase salah'),
)
const jsFlipped = (jsBlob.ciphertext[0] === '0' ? '1' : '0') + jsBlob.ciphertext.slice(1)
ok(
	'js: ciphertext diutak-atik DITOLAK',
	(await toErrorAsync(() => decryptSecret({ ...jsBlob, ciphertext: jsFlipped }, PASSPHRASE, jsCrypto))).includes('Passphrase salah'),
)
ok(
	'js: salt+iv acak (dua enkripsi berbeda)',
	jsBlob.salt !== (await encryptSecret(SECRET, PASSPHRASE, FAST, jsCrypto)).salt,
)

// --- interop dua arah: wallet dibuat di http harus terbuka di https dan sebaliknya ---
ok(
	'interop: blob fallback JS dibuka oleh Web Crypto',
	(await decryptSecret(jsBlob, PASSPHRASE, nativeCrypto)) === SECRET,
)
ok(
	'interop: blob Web Crypto dibuka oleh fallback JS',
	(await decryptSecret(blob, PASSPHRASE, jsCrypto)) === SECRET,
)

const jsDefaultBlob = await encryptSecret(SECRET, PASSPHRASE, undefined, jsCrypto)
ok(
	'js: parameter produksi (PBKDF2 310k iterasi) roundtrip',
	jsDefaultBlob.iterations === KDF_ITERATIONS &&
		(await decryptSecret(jsDefaultBlob, PASSPHRASE, jsCrypto)) === SECRET,
)

// ============ 1c. subtle hilang -> pemanggilan TANPA paksaan jatuh ke fallback ============
console.log('\n--- simulasi origin http: globalThis.crypto TANPA subtle ---')

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
Object.defineProperty(globalThis, 'crypto', {
	configurable: true,
	// Persis kondisi insecure context: getRandomValues MASIH ada, subtle TIDAK.
	value: {
		getRandomValues: (array: ArrayBufferView): ArrayBufferView =>
			nativeCrypto.getRandomValues(array),
	},
})
try {
	ok('simulasi: crypto.subtle benar-benar hilang', globalThis.crypto.subtle === undefined)

	// Tanpa argumen keempat = memakai getCrypto() internal, yaitu jalur yang
	// dilewati pengguna saat membuka http://<ip-lan>:5174.
	const insecureBlob = await encryptSecret(SECRET, PASSPHRASE, FAST)
	ok(
		'getCrypto: TIDAK melempar "membutuhkan konteks aman" lagi',
		(await decryptSecret(insecureBlob, PASSPHRASE)) === SECRET,
	)
} finally {
	if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
}
ok('simulasi: crypto dikembalikan ke kondisi semula', globalThis.crypto.subtle !== undefined)

// ============ 2. vault: create / unlock / lock ============
console.log('\n--- walletVault: create / unlock / lock ---')

const kv: WalletKV = createMemoryKV()
const vault = createWalletVault(kv)

ok('vault kosong: hasWallet false', (await vault.hasWallet()) === false)
ok('vault kosong: getInfo undefined', (await vault.getInfo()) === undefined)
ok(
	'vault kosong: unlock DITOLAK',
	(await toErrorAsync(() => vault.unlock(PASSPHRASE))).includes('kosong'),
)

const info = await vault.create(PASSPHRASE)
ok('create: alamat format NxC + 40 hex', /^NxC[0-9a-f]{40}$/.test(info.address), info.address)
ok('create: hasWallet true', (await vault.hasWallet()) === true)
ok('create: vault langsung terbuka', vault.isUnlocked() === true)

const created = vault.getUnlocked()
const direct = generateKeysFromMnemonic(created.mnemonic)
ok('create: private key identik dengan turunan langsung', created.privateKey === direct.privateKey)
ok(
	'create: alamat identik dengan turunan langsung',
	created.address === generateAddressFromPublicKey(direct.publicKey.slice(2)),
)

// --- record tersimpan tidak boleh membocorkan rahasia ---
const record = await kv.get<VaultRecord>('primary')
ok('record ada & punya blob', record !== undefined && record.blob !== undefined)
if (record) {
	const dump = JSON.stringify(record)
	ok('record TIDAK memuat mnemonic (plaintext)', !dump.includes(created.mnemonic))
	ok(
		'record TIDAK memuat private key (plaintext)',
		!dump.includes(direct.privateKey.replace(/^Nx/, '')),
	)
	ok(
		'record memuat alamat + publicKey (publik, boleh plaintext)',
		record.address === info.address && record.publicKey === info.publicKey,
	)
	ok('record blob memakai KDF produksi', record.blob.iterations === KDF_ITERATIONS)
} else {
	ok('record ada (dibatalkan karena undefined)', false)
	ok('record tidak bocor (dibatalkan karena undefined)', false)
	ok('record memuat info publik (dibatalkan karena undefined)', false)
	ok('record blob memakai KDF produksi (dibatalkan)', false)
}

// --- lock / unlock ---
vault.lock()
ok('lock: isUnlocked false', vault.isUnlocked() === false)
ok('lock: getUnlocked DITOLAK', toError(() => vault.getUnlocked()).includes('terkunci'))
ok('lock: getInfo tetap terbaca tanpa passphrase', (await vault.getInfo())?.address === info.address)

ok(
	'unlock: passphrase salah DITOLAK',
	(await toErrorAsync(() => vault.unlock(WRONG))).includes('Passphrase salah'),
)
ok('unlock: gagal -> tetap terkunci', vault.isUnlocked() === false)

const reopened = await vault.unlock(PASSPHRASE)
ok('unlock: passphrase benar -> info cocok', reopened.address === info.address)
ok('unlock: mnemonic roundtrip persis', vault.getUnlocked().mnemonic === created.mnemonic)
ok('unlock: private key konsisten', vault.getUnlocked().privateKey === created.privateKey)

// ============ 3. persistensi antar-instance ============
console.log('\n--- walletVault: persistensi (buka-tutup aplikasi) ---')

vault.lock()
const vault2 = createWalletVault(kv) // "reload" — status terbuka tidak dibawa
ok('reload: isUnlocked mulai false', vault2.isUnlocked() === false)
ok('reload: info masih terbaca', (await vault2.getInfo())?.address === info.address)
await vault2.unlock(PASSPHRASE)
ok('reload: unlock menghasilkan private key sama', vault2.getUnlocked().privateKey === created.privateKey)

// ============ 4. import ============
console.log('\n--- walletVault: importMnemonic ---')

// Vault masih terisi dari `create`, jadi kosongkan dulu.
await vault2.wipe()
ok('import: setelah wipe vault kosong', (await vault2.hasWallet()) === false)

const imported = await vault2.importMnemonic(SECRET, IMPORT_PASS)
ok(
	'import: alamat sama dengan turunan langsung',
	imported.address === generateAddressFromPublicKey(generateKeysFromMnemonic(SECRET).publicKey.slice(2)),
)
ok('import: mnemonic tersimpan utuh', vault2.getUnlocked().mnemonic === SECRET)
ok(
	'import: mnemonic tidak valid DITOLAK',
	(await toErrorAsync(() => vault.importMnemonic('bukan mnemonic sama sekali', IMPORT_PASS))).includes('Invalid mnemonic'),
)
ok(
	'import: vault sudah terisi DITOLAK',
	(await toErrorAsync(() => vault.importMnemonic(SECRET, IMPORT_PASS))).includes('sudah berisi'),
)

// ============ 5. address anchor ke jalur Node ============
console.log('\n--- anchor: jalur vault == jalur Node ---')
try {
	const parsed = JSON.parse(readFileSync('wallet/main.json', 'utf8')) as {
		address: string
		phrase: string
	}
	const derived = generateKeysFromMnemonic(parsed.phrase)
	const addr = generateAddressFromPublicKey(derived.publicKey.slice(2))
	ok(
		'anchor: phrase wallet/main.json -> address cocok dengan yang tercatat',
		addr === KNOWN_MAIN_ADDRESS,
		addr,
	)
	ok(
		'anchor: address tercatat == address turunan',
		parsed.address === KNOWN_MAIN_ADDRESS,
		parsed.address,
	)
} catch {
	console.log('  SKIP anchor wallet/main.json (tidak bisa dibaca)')
}

// ============ 6. wipe ============
console.log('\n--- walletVault: wipe ---')
await vault.wipe()
ok('wipe: hasWallet false', (await vault.hasWallet()) === false)
ok('wipe: getInfo undefined', (await vault.getInfo()) === undefined)
ok('wipe: terkunci', vault.isUnlocked() === false)
ok('wipe: setelah wipe bisa create lagi', (await vault.create(PASSPHRASE)).address.startsWith('NxC'))

// ============ 7. backend IndexedDB sungguhan ============
console.log('\n--- IndexedDB: createIdbKV dieksekusi (fake-indexeddb) ---')

const IDB_DB = 'nex-wallet-idb-proof'
const idbKV = await createIdbKV(IDB_DB)
const idbVault = createWalletVault(idbKV)
ok('idb: buka database & object store', idbKV !== undefined)
ok('idb: vault kosong', !(await idbVault.hasWallet()))

const idbInfo = await idbVault.create(PASSPHRASE)
ok('idb: create -> alamat format NxC + 40 hex', /^NxC[0-9a-f]{40}$/.test(idbInfo.address), idbInfo.address)
const idbUnlocked = idbVault.getUnlocked()

const idbRecord = await idbKV.get<VaultRecord>('primary')
ok('idb: record benar-benar masuk IndexedDB (put/get)', idbRecord !== undefined)
ok(
	'idb: structured-clone utuh (kdf + alamat)',
	idbRecord?.blob.kdf === KDF_NAME && idbRecord?.address === idbInfo.address,
)
if (idbRecord) {
	ok(
		'idb: record TIDAK memuat mnemonic',
		!JSON.stringify(idbRecord).includes(idbUnlocked.mnemonic),
	)
} else {
	ok('idb: record TIDAK memuat mnemonic (gagal: record tak ada)', false)
}

// Koneksi kedua = simulasi buka-tutup tab
idbVault.lock()
const idbKV2 = await createIdbKV(IDB_DB)
const idbVault2 = createWalletVault(idbKV2)
ok('idb: koneksi kedua membaca record sama', (await idbVault2.getInfo())?.address === idbInfo.address)

let idbWrongRejected = false
try {
	await idbVault2.unlock(WRONG)
} catch {
	idbWrongRejected = true
}
ok('idb: passphrase salah ditolak & tetap terkunci', idbWrongRejected && !idbVault2.isUnlocked())

await idbVault2.unlock(PASSPHRASE)
ok(
	'idb: unlock menghasilkan private key sama persis',
	idbVault2.getUnlocked().privateKey === idbUnlocked.privateKey,
)

await idbVault.wipe()
ok('idb: record terhapus (delete)', (await idbKV.get('primary')) === undefined)
ok('idb: vault kosong lagi setelah wipe', !(await idbVault.hasWallet()))

console.log(`\n  ============ ${pass} OK / ${fail} FAIL ============`)
process.exit(fail > 0 ? 1 : 0)
