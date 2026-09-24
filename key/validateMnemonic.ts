// Named import wajib — lihat alasan interop di key/genRandomMnemonic.ts.
import { validateMnemonic as bip39ValidateMnemonic } from 'bip39'

// Fungsi untuk memvalidasi mnemonic
export const validateMnemonic = (mnemonic: string) => {
	const isValid = bip39ValidateMnemonic(mnemonic)
	if (!isValid) {
		throw new Error('Invalid mnemonic phrase')
	}
}
