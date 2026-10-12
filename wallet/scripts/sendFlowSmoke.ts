/**
 * Smoke test alur kirim paket `wallet/` — jalur import yang SAMA dengan
 * bundle (alias root module + polyfill Buffer npm).
 *
 * Bukti yang diberikan:
 *   1. Buffer NATIF Node/Bun dibuang dulu → semua operasi berikutnya
 *      berjalan di atas `buffer` npm (implementasi yang ikut ke bundle),
 *      sehingga crash `Buffer.from` ala bip39 di browser pasti terdeteksi.
 *   2. Vault Phase C penuh: create → lock → unlock (salah passphrase gagal).
 *   3. Alur kirim murni: validate → createUnsigned → sign → encodeTx.
 *   4. Interop bip39 (akar bug runtime browser): module.exports bip39 menandai
 *      __esModule TANPA properti default, sehingga default-import pada jalur
 *      Vite menghasilkan undefined dan crash di SetupWallet. Guard memaksa
 *      named import di seluruh root module dan memanggil
 *      genRandomMnemonic/validateMnemonic — jalur persis yang dulu crash.
 *
 * Catatan: TIDAK menyentuh LevelDB/mempool (single-process lock) dan tidak
 * mengirim transaksi apa pun — cukup komposisi + tanda tangan lokal.
 *
 * Jalankan: bun scripts/sendFlowSmoke.ts
 */
import { Buffer as BufferNpm } from 'buffer'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMemoryKV } from 'src/client/wallet/kv'
import { createWalletVault } from 'src/client/wallet/walletVault'
import { genRandomMnemonic } from 'src/crypto/generateRandomMnemonic'
import { validateMnemonic } from 'src/crypto/validateMnemonic'
import { createUnsignedTransaction } from 'src/client/lib/createUnsignedTransaction'
import { signTransaction } from 'src/crypto/signTransaction'
import { encodeTx } from 'src/core/encoding/hex/tx/encodeTx'
import { validateSendForm } from '../src/lib/sendFlow'
import type { SendForm } from '../src/lib/sendFlow'

let passed = 0
let failed = 0

const ok = (condition: boolean, label: string): void => {
	if (condition) {
		passed += 1
		console.log(`OK   ${label}`)
	} else {
		failed += 1
		console.log(`FAIL ${label}`)
	}
}

const main = async (): Promise<void> => {
	// --- 1. paksa Buffer npm (bukti jalur browser) ---
	const g = globalThis as { Buffer?: unknown }
	const nativeBuffer = g.Buffer
	g.Buffer = BufferNpm
	try {
		// operasi khas bip39 di atas buffer npm
		ok(
			BufferNpm.from('abc').toString('hex') === '616263',
			'buffer npm: Buffer.from bekerja',
		)
		ok(
			BufferNpm.isBuffer(BufferNpm.from([1, 2, 3])),
			'buffer npm: Buffer.isBuffer bekerja',
		)

		// --- 2. vault Phase C di atas KV memori ---
		const kv = createMemoryKV()
		const vault = createWalletVault(kv)
		ok(!(await vault.hasWallet()), 'vault baru: kosong')

		// frasa dibangkitkan lewat modul key/ yang SAMA dengan jalur UI (SetupWallet)
		const phrase = genRandomMnemonic()
		const info = await vault.importMnemonic(phrase, 'rahasia-123')
		ok(
			(await vault.hasWallet()) && info.address.startsWith('NxC'),
			'vault: import mnemonic + alamat NxC',
		)
		ok(vault.isUnlocked(), 'vault: langsung terbuka setelah import')

		const derived = vault.getUnlocked()
		ok(derived.mnemonic === phrase, 'vault: mnemonic terbuka = mnemonic impor')

		vault.lock()
		ok(!vault.isUnlocked(), 'vault: lock mengosongkan kunci')

		let wrongRejected = false
		try {
			await vault.unlock('salah')
		} catch {
			wrongRejected = true
		}
		ok(wrongRejected, 'vault: passphrase salah ditolak')

		await vault.unlock('rahasia-123')
		ok(
			vault.getUnlocked().address === info.address,
			'vault: unlock mengembalikan alamat sama',
		)

		// --- 3. alur kirim murni (tanpa I/O) ---
		const receiver = 'NxC' + '0'.repeat(39) + '1'
		const form: SendForm = {
			receiver,
			amountNxc: '1.5',
			feeNexu: '5000',
		}
		const errors = validateSendForm(form, info.address)
		ok(
			Object.keys(errors).length === 0,
			'sendFlow: form valid lolos validasi (mirror server)',
		)

		const bad = validateSendForm(
			{ ...form, feeNexu: '999999999999999999999999' },
			info.address,
		)
		ok(bad.fee !== undefined, 'sendFlow: fee > jumlah ditolak (aturan server)')

		const unsigned = createUnsignedTransaction(
			{
				receiver: form.receiver,
				format: 'NXC',
				sender: info.address,
				amount: Number(form.amountNxc),
				timestamp: Date.now(),
				fee: Number(form.feeNexu),
			},
			0,
		)
		ok(
			unsigned.status && unsigned.tx !== undefined,
			'alur: createUnsignedTransaction sukses',
		)

		if (unsigned.tx) {
			const signed = signTransaction(unsigned.tx, derived.privateKey)
			ok(
				signed.sign.r.length > 0 &&
					signed.sign.s.length > 0 &&
					signed.sign.v > 0,
				'alur: signTransaction menghasilkan r/s/v',
			)
			const encoded = encodeTx(signed)
			ok(
				typeof encoded === 'string' && encoded.length > 0,
				'alur: encodeTx menghasilkan base64',
			)
			ok(
				/^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
				'alur: payload berupa base64 msgpack (bukan JSON telanjang)',
			)
		}

		// --- 4. interop bip39 — regresi crash browser (default-import) ---
		//    Akar bug: bip39 v3 keluaran tsc menandai __esModule pada
		//    module.exports TANPA properti default, sehingga transform Vite
		//    `ns.__esModule ? ns.default : ns` bernilai undefined. Node/Bun
		//    memakai aturan berbeda (default = module.exports) sehingga bug ini
		//    TIDAK pernah terdeteksi oleh gate runtime di Bun.
		const requireCjs = createRequire(import.meta.url)
		const bip39Ns = requireCjs('bip39') as {
			__esModule?: boolean
			default?: unknown
		}
		ok(
			bip39Ns.__esModule === true && bip39Ns.default === undefined,
			'interop: bip39 __esModule=true TANPA properti default (akar bug)',
		)
		ok(
			(bip39Ns.__esModule ? bip39Ns.default : bip39Ns) === undefined,
			'interop: jalur default-import Vite = undefined (bug lama kini terhindar)',
		)

		ok(
			genRandomMnemonic().trim().split(/\s+/).length === 12,
			'key/genRandomMnemonic (named import) menghasilkan 12 kata',
		)
		let badRejected = false
		try {
			validateMnemonic('ini bukan frasa mnemonic yang valid')
		} catch {
			badRejected = true
		}
		ok(badRejected, 'key/validateMnemonic: frasa sampah DITOLAK')

		// Guard: nol default-import bip39 di seluruh root module yang di-alias UI.
		const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
		const scanDirs = [
			'account',
			'base',
			'client',
			'common',
			'interface',
			'key',
			'logging',
			'nexchain',
			'p2p',
			'rpc',
			'scripts',
			'sign',
			'wallet',
		]
		let offender = ''
		for (const dir of scanDirs) {
			const abs = join(repoRoot, dir)
			if (!existsSync(abs)) continue
			for (const rel of readdirSync(abs, { recursive: true }) as string[]) {
				if (typeof rel !== 'string' || !rel.endsWith('.ts')) continue
				const text = readFileSync(join(abs, rel), 'utf8')
				if (/^import\s+\w+\s+from\s+['"]bip39['"]/m.test(text)) {
					offender = `${dir}/${rel}`
					break
				}
			}
			if (offender) break
		}
		ok(
			offender === '',
			offender
				? `default-import bip39 di ${offender} (akan crash di Vite)`
				: 'guard: nol default-import bip39 di seluruh root module',
		)
	} finally {
		g.Buffer = nativeBuffer
	}

	console.log(`\n${passed} OK / ${failed} FAIL`)
	if (failed > 0) process.exit(1)
}

void main()
