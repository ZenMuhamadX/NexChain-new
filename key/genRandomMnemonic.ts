// WAJIB named import (bukan `import bip39 from 'bip39'`): bip39 v3 keluaran
// tsc menandai `__esModule` pada module.exports TANPA properti default, sehingga
// jalur interop Vite (`ns.__esModule ? ns.default : ns`) bernilai undefined dan
// crash di browser. Named import mentransform jadi akses properti langsung ke
// module.exports — identik hasilnya di Node/Bun dan browser.
import { generateMnemonic } from 'bip39'

export const genRandomMnemonic = () => {
	return generateMnemonic(128)
}
