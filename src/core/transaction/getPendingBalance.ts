import { rocksState } from 'src/core/state/db/state'
import { decodeFromBytes } from 'src/core/encoding/hex/bytes/decodeBytes'
import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { pendingBalance } from './setPendingBalance'

/**
 * Muat pending balance (reserve transaksi belum dieksekusi) sebuah alamat.
 *
 * DUA aturan keras (audit P1 #3):
 *
 *   1. Alamat DIVALIDASI dulu — alamat rusak MELEMPAR, bukan diam-diam
 *      mengembalikan 0. Nol diam-diam menyamarkan serangan (typo/salah
 *      param yang terlihat "berhasil", dan pemanggil tidak bisa membedakan
 *      "tidak ada reserve" dari "alamat salah").
 *   2. TANPA TULIS-SAAT-BACA: kunci yang hilang menghasilkan
 *      `{ pendingAmount: 0 }` tanpa menyimpan apa pun. Menulis 0 saat
 *      membaca (perilaku lama) membuat pembacaan RPC sembarang menumbuhkan
 *      key `pendingBalance:<alamat>` sampah di DB negara-bagian, dan
 *      menyamarkan siapa penulis reserve yang SAH (hanya admission
 *      `memPool` dan pelepasan `processSender` yang boleh menulis).
 *
 * Pemanggil: admission mempool (`memPool.handleUserTransaction` — `from`
 * hasil ecrecover, selalu sah), eksekusi blok (`processSender`), dan RPC
 * `nex_getPendingBalance` (lapisan json-rpc mengubah throw menjadi
 * respons error JSON-RPC — bukan kegagalan HTTP).
 */
export const getPendingBalance = async (
	address: string,
): Promise<pendingBalance> => {
	if (!isValidAddress(address)) {
		throw new Error(`getPendingBalance: alamat tidak valid: ${address}`)
	}
	try {
		// Ambil pending balance dari database berdasarkan alamat
		const pendingBalanceData = await rocksState
			.get(`pendingBalance:${address}`)
			.catch(() => null)

		if (!pendingBalanceData) {
			// Tidak ada reserve tersimpan = tidak ada transaksi pending.
			// Sengaja TIDAK menulis apa pun (tanpa tulis-saat-baca).
			return { pendingAmount: 0, address }
		}

		// Jika pending balance ada, decode dan parse
		const parsedBytes = decodeFromBytes(pendingBalanceData as unknown as Buffer)
		return JSON.parse(parsedBytes) as pendingBalance
	} catch (error) {
		console.error(error)
		throw error
	}
}
