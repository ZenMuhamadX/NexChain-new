import { TxInterface } from 'src/types/transaction'
import { decodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { base64ToUint8 } from '../base64/base64ToUint8'

/**
 * Decode transaksi dari string `params` JSON-RPC.
 *
 * Kebalikan `encodeTx`: `base64` → byte → `0x02` (tipe) + RLP.
 *
 * Yang penting di sini: `txHash` dan `from` **dihitung**, bukan dipercaya.
 *   - `txHash` = `sha256(payload bertipe)` — hash dari byte yang benar-benar
 *     diterima.
 *   - `from`   = `ecrecover(sighash, v, r, s)` — pengirim TIDAK dikirim di
 *     wire sama sekali; ia dipulihkan dari tanda tangannya sendiri.
 *
 * Sebelumnya client mengirim `txHash` dan `hexInput` apa adanya dan node
 * memakainya tanpa pemeriksaan — sehingga client yang bermasalah (atau jahat)
 * bisa mengirim nilai yang tidak cocok dengan isi transaksinya. Sekarang hal
 * itu mustahil: tidak ada nilai turunan yang datang dari luar.
 *
 * Payload rusak ditolak keras: base64 tidak valid, tipe transaksi tidak
 * dikenal, list tidak berisi 8 item, atau integer non-kanonik semuanya
 * melempar error — bukan menghasilkan transaksi setengah benar.
 *
 * DIPAKAI HANYA OLEH NODE (`rpc/method.ts`). Lihat catatan peran di
 * `encodeTx.ts`.
 */
export const decodeTx = (data: string): TxInterface => {
	if (typeof data !== 'string' || data.length === 0) {
		throw new Error('decodeTx: payload harus string base64 yang tidak kosong')
	}
	return decodeTxPayload(base64ToUint8(data))
}
