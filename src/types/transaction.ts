import { HexString } from 'src/types/block'

/**
 * Transaksi ON-CHAIN — data immutable yang ditandatangani pengirim.
 *
 * Bentuknya mengikuti model Ethereum: hanya memuat data yang benar-benar
 * ditandatangani, tanpa state siklus hidup dan tanpa identitas pengirim yang
 * dikirim ulang.
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
 *   - **`sender`** → TIDAK dikirim. Pengirim adalah hasil `ecrecover` atas
 *                    tanda tangannya sendiri (lihat `from`).
 *
 * ## Field TURUNAN
 *
 * Dua field di bawah ini TIDAK pernah ada di wire; keduanya dihitung:
 *
 *   - `from`   = `ecrecover(sighash, v, r, s)` → alamat penanda tangan.
 *                Tanda tangan ADALAH definisi pengirim, bukan klaim tentang
 *                pengirim. Karena itu tidak ada yang perlu dicocokkan: nilai
 *                hasil pemulihan langsung dipakai. Sama seperti Ethereum,
 *                yang tidak menyimpan `from` di dalam transaksinya.
 *   - `txHash` = `sha256(payload bertipe)` — hash dari byte yang benar-benar
 *                dikirim.
 *
 * Karena keduanya turunan, keduanya `optional`: transaksi yang belum
 * ditandatangani (draft dari `createUnsignedTransaction`) memang belum
 * memilikinya. `signTransaction` dan `decodeTxPayload` yang mengisinya.
 *
 * Catatan `sender` pada `comTxInterface` (niat pengguna) adalah hal berbeda:
 * itu alamat milik user sendiri, dipakai untuk mengambil nonce — bukan bagian
 * transaksi on-chain.
 */
export interface TxInterface {
	nonce: number
	fee: number
	receiver: string
	amount: number
	/** Data arbitrer (UTF-8 direpresentasikan sebagai hex). Opsional. */
	data?: HexString
	sign: {
		v: number
		r: string
		s: string
	}
	/**
	 * TURUNAN — alamat penanda tangan, dipulihkan dari tanda tangan lewat
	 * `ecrecover`. Tidak pernah dikirim di wire.
	 */
	from?: string
	/** TURUNAN — `sha256(payload bertipe)`. Tidak pernah dikirim di wire. */
	txHash?: string
}
