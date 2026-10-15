import { isValidAddress } from 'src/core/transaction/utils/isValidAddress'
import { sumCostBySender } from 'src/core/state/storage/mempool/mempoolIndex'

/**
 * Bentuk reserve turunan satu alamat — dipindah ke sini dari
 * `setPendingBalance.ts` yang DIHAPUS (Gelombang 2): tidak ada lagi modul
 * penulis `pendingBalance:<alamat>`, jadi tipe milik pembaca ini.
 */
export interface pendingBalance {
	address: string
	pendingAmount: number
}

/**
 * Muat reserve (dana terkunci transaksi belum dieksekusi) sebuah alamat —
 * TURUNAN dari indeks mempool per-pengirim, BUKAN kunci tersimpan.
 *
 * Mengapa turunan: kunci `pendingBalance:<alamat>` yang lama adalah counter
 * terpisah yang ditulis di dua tempat (admission `memPool` menaikkan,
 * `processSender` menurunkan). Satu tulis hilang (crash di luar batch, bug
 * penulis berikutnya) menyesatkan selamanya — reserve menumpuk tanpa bisa
 * dilepas (dana terkunci permanen) atau nol padahal tx masih pending
 * (over-admission). Nilai turunan (`Σ(amount+fee)` dari `mpf:<from>:*` yang
 * ditulis ATOMIK bersama tx oleh `saveMempool`) tidak mungkin drift: indeks
 * ada ⟺ tx ada.
 *
 * DUA aturan keras (audit P1 #3) tetap berlaku:
 *
 *   1. Alamat DIVALIDASI dulu — alamat rusak MELEMPAR, bukan diam-diam
 *      mengembalikan 0. Nol diam-diam menyamarkan serangan (typo/salah
 *      param yang terlihat "berhasil", dan pemanggil tidak bisa membedakan
 *      "tidak ada reserve" dari "alamat salah").
 *   2. TANPA TULIS-SAAT-BACA: pembaca ini hanya memindai indeks; ia tidak
 *      menulis kunci apa pun.
 *
 * Pemanggil: admission mempool (`memPool.handleUserTransaction` — `from`
 * hasil ecrecover, selalu sah) dan RPC `nex_getPendingReserve` (lapisan
 * json-rpc mengubah throw menjadi respons error JSON-RPC — bukan kegagalan
 * HTTP).
 */
export const getPendingBalance = async (
	address: string,
): Promise<pendingBalance> => {
	if (!isValidAddress(address)) {
		throw new Error(`getPendingBalance: alamat tidak valid: ${address}`)
	}
	return { address, pendingAmount: await sumCostBySender(address) }
}
