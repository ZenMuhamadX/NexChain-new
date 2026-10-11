import { TxInterface } from 'src/types/transaction'
import { decodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { base64ToUint8 } from '../base64/base64ToUint8'

/**
 * Decode transaksi dari string `params` JSON-RPC.
 *
 * Kebalikan `encodeTx`: `base64` → byte → `0x01` (tipe) + RLP.
 *
 * Yang penting di sini: `txHash` dan `hexInput` **dihitung ulang** dari field
 * yang diterima, bukan dipercaya dari client. Sebelumnya keduanya dikirim
 * apa adanya oleh client dan node memakainya tanpa pemeriksaan — sehingga
 * client yang bermasalah (atau jahat) bisa mengirim `txHash`/`hexInput` yang
 * tidak cocok dengan isi transaksinya. Sekarang hal itu mustahil.
 *
 * Payload rusak ditolak keras: base64 tidak valid, tipe transaksi tidak
 * dikenal, list tidak berisi 10 item, atau integer non-kanonik semuanya
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
