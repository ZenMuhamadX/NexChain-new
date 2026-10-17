import { rpcRequest } from '../lib/rpcRequest'

const toNonce = (raw: unknown): number =>
	typeof raw === 'number' && Number.isFinite(raw) ? raw : 0

/**
 * Query nonce yang DIPERLUKAN oleh transaksi berikutnya.
 *
 * Bukan sekadar nonce akun: node menghitung
 * `accountNonce + jumlah transaksi sender yang masih pending di mempool`
 * (lewat `nex_getNextNonce`), aturan yang sama persis dengan
 * `validateTransactionNonce`.
 *
 * Kenapa ini penting: `nex_getNonceAccount` hanya mengembalikan nonce akun
 * yang sudah dikonfirmasi blok. Memakai nilai itu, wallet hanya bisa mengirim
 * SATU transaksi per blok — transaksi ke-2 selalu ditolak node dengan
 * "Invalid nonce: expected 1, got 0" sampai blok berikutnya ter-mining.
 *
 * Penghitungannya dilakukan di server supaya client tidak perlu mengunduh
 * seluruh mempool hanya untuk menghitung transaksinya sendiri.
 *
 * Fallback ke `nex_getNonceAccount` dipertahankan untuk node lama yang belum
 * punya `nex_getNextNonce` (transaksi pertama tetap jalan, transaksi kedua
 * baru ditolak).
 */
export const getNonce = async (address: string): Promise<number> => {
	try {
		return toNonce(await rpcRequest('nex_getNextNonce', address))
	} catch {
		try {
			return toNonce(await rpcRequest('nex_getNonceAccount', address))
		} catch {
			return 0
		}
	}
}
