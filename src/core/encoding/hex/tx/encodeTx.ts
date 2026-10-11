import { TxInterface } from 'src/types/transaction'
import { encodeTxPayload } from 'src/core/encoding/rlp/txCodec'
import { uint8ToBase64 } from '../base64/uint8ToBase64'

/**
 * Encode transaksi menjadi string untuk `params` JSON-RPC.
 *
 * Format: `base64(0x01 ‖ rlp([...]))`.
 *
 * RLP itu biner, dan JSON-RPC hanya bisa membawa string — jadi byte RLP
 * dibungkus base64. Skemanya ada di `core/encoding/rlp/txCodec.ts`.
 *
 * Sebelumnya fungsi ini memakai `base64(msgpack(JSON.stringify(tx)))`.
 * Rantai itu mengandung dua pemborosan yang sekarang hilang:
 *
 *   1. `msgpack` di-encode atas STRING hasil `JSON.stringify`, bukan atas
 *      objeknya — jadi ia tidak menghapus nama field sama sekali dan hanya
 *      menambah ~3 byte. Manfaat aslinya tidak pernah didapat.
 *   2. `JSON.stringify` ikut mengirim field turunan (`hexInput`, `txHash`)
 *      dan status yang node-managed (`status`, `isValid`, `isPending`),
 *      ditambah nama field yang ditulis ulang di setiap transaksi.
 *
 * Ukuran payload turun dari ~1.228 karakter menjadi ~180 karakter.
 *
 * DIPAKAI HANYA OLEH CLIENT (wallet & CLI). Node tidak pernah meng-encode
 * transaksi untuk dikirim; ia hanya meng-decode (`decodeTx`). Keduanya
 * diletakkan berdampingan karena mendefinisikan satu kontrak wire yang sama.
 */
export const encodeTx = (transaction: TxInterface): string =>
	uint8ToBase64(encodeTxPayload(transaction))
