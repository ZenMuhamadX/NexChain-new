import { HexString } from 'src/types/block'

/**
 * Transaksi ON-CHAIN — data immutable yang ditandatangani pengirim.
 *
 * Bentuknya mengikuti model Ethereum: hanya memuat data yang benar-benar
 * ditandatangani, tanpa state siklus hidup.
 *
 * Yang SENGAJA tidak ada:
 *
 *   - `timestamp`  → milik blok. Waktu transaksi dibaca dari
 *                    `metadata.blockTimestamp` pada entri riwayat.
 *   - `format`     → digantikan byte tipe transaksi di wire (`0x02`).
 *   - `hexInput`   → turunan; dihapus, tidak pernah diverifikasi siapa pun.
 *   - `status`, `isValid`, `isPending`
 *                  → state siklus hidup. Diturunkan dari fakta rantai
 *                    (keanggotaan blok), bukan disimpan di dalam transaksi.
 *   - `chainId`    → dibawa `sign.v` (EIP-155) dan ikut di preimage tanda
 *                    tangan; tidak perlu field terpisah.
 *
 * `txHash` bersifat TURUNAN: dihitung SETELAH signing sebagai
 * `sha256(payload bertipe)` — hash dari byte yang benar-benar dikirim. Karena
 * itu ia opsional: transaksi yang belum ditandatangani belum punya txHash.
 *
 * `sender` untuk sementara MASIH disimpan (Fase 4 menundanya). Penghapusannya
 * kini terbuka: tidak ada lagi transaksi tanpa tanda tangan di rantai
 * (coinbase sudah keluar dari daftar transaksi), sehingga `sender` bisa
 * dipulihkan lewat `ecrecover` di semua kasus.
 */
export interface TxInterface {
	nonce: number
	fee: number
	sender: string
	receiver: string
	amount: number
	/** Data arbitrer (UTF-8 direpresentasikan sebagai hex). Opsional. */
	data?: HexString
	sign: {
		v: number
		r: string
		s: string
	}
	/** `sha256(payload bertipe)` — dihitung setelah signing. */
	txHash?: string
}
