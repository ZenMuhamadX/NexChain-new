import { validateMnemonic } from './validateMnemonic'
// Named import wajib — lihat alasan interop di key/genRandomMnemonic.ts.
import { mnemonicToSeedSync } from 'bip39'
import BIP32Factory from 'bip32'
import { ecc } from './ecc'
import { uint8ToHex } from 'account/backup/lib/bytesToHex'

// Pakai adapter elliptic (murni JS) menggantikan tiny-secp256k1, karena
// tiny-secp256k1 memuat WebAssembly dengan gaya webpack yang gagal dibundle
// untuk browser. BIP32Factory(ecc) juga menjalankan testEcc() bawaan bip32,
// sehingga adapter langsung divalidasi terhadap test-vector setiap dipakai.
const bip32 = BIP32Factory(ecc)
// Fungsi untuk menghasilkan kunci dari mnemonic
export const generateKeysFromMnemonic = (mnemonic: string) => {
	validateMnemonic(mnemonic)

	const seed = mnemonicToSeedSync(mnemonic)
	const masterNode = bip32.fromSeed(seed)
	const childNode = masterNode.derivePath("m/44'/60'/0'/0/0")

	const privateKey = uint8ToHex(childNode.privateKey!)
	const publicKey = uint8ToHex(childNode.publicKey!)

	return { privateKey: `Nx${privateKey}`, publicKey: `Nx${publicKey}` }
}
